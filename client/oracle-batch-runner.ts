/**
 * Atomic Oracle ADF batch runner for differential two-application merges.
 * Processes dependency stages sequentially; sends independent same-stage
 * batches with bounded concurrency. Never retries an uncertain write.
 */
type BatchChange={object:string;id:string;action:'create'|'update';changedFields:string[]};
type BatchRecord=Record<string,string>;
type BatchTable={columns:string[];rows:BatchRecord[]};
type BatchRelation={field:string;target:string};
type OracleBatchReply={parts?:Array<{id?:string;operation?:string;payload?:Record<string,unknown>;status?:number;error?:unknown}>};
type BatchCommitted={stage:number;table:string;ids:string[];operations:Array<{sourceId:string;oracleId:string;action:'create'|'update'}>};
type BatchExecutorOptions={
 changes:BatchChange[];
 tables:Record<string,BatchTable>;
 relations:Record<string,readonly BatchRelation[]>;
 stages:string[][];
 batchSize:number;
 concurrency:number;
 normalize:(table:string,row:BatchRecord,columns:string[])=>Record<string,unknown>;
 send:(parts:Array<{id:string;path:string;operation:'create'|'update';payload:Record<string,unknown>}>)=>Promise<OracleBatchReply>;
 resume?:{completed:Record<string,string[]>;mappings:Record<string,Record<string,string>>};
 onCommit?:(batch:BatchCommitted)=>void;
 shouldStop?:()=>boolean;
};
async function executeOracleBatches(options:BatchExecutorOptions){
 const {changes,tables,relations,stages,normalize,send}=options;
 const batchSize=options.batchSize,concurrency=options.concurrency;
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>25)throw Error('Tamaño batch inválido (1–25).');
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>3)throw Error('Concurrencia batch inválida (1–3).');
 const active=stages.flat(),set=new Set(active);
 if(active.length!==set.size)throw Error('Un BO aparece más de una vez en las etapas.');
 const group=new Map<string,BatchChange[]>();
 for(const change of changes){
  if(!set.has(change.object))throw Error('Un BO del diferencial no aparece en el plan: '+change.object);
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(change.object)||!/^[A-Za-z0-9._~-]+$/.test(change.id))
   throw Error('BO o ID inválido en el diferencial.');
  const done=options.resume?.completed?.[change.object]||[];
  if(done.includes(change.id))continue;
  const rows=group.get(change.object)||[];
  rows.push(change);group.set(change.object,rows);
 }
 const records=new Map<string,Map<string,BatchRecord>>();
 for(const [name,table] of Object.entries(tables))
  records.set(name,new Map(table.rows.map(row=>[String(row.id),row])));
 const created=new Map<string,Set<string>>();
 for(const change of changes)if(change.action==='create'){
  if(!created.has(change.object))created.set(change.object,new Set());
  created.get(change.object)!.add(change.id);
 }
 for(const change of changes){
  const original=records.get(change.object)?.get(change.id);
  if(!original)throw Error('No existe la fila diferencial '+change.object+'/'+change.id);
  for(const rel of relations[change.object]||[]){
   const parentId=String(original[rel.field]??'').trim();
   if(!parentId)continue;
   if(rel.target===change.object&&created.get(change.object)?.has(parentId))
    throw Error('BO con dependencia interna entre filas nuevas: '+change.object+
      ' ID '+change.id+' depende de '+parentId+'. Publícalo secuencialmente en V1.');
  }
 }
 const mapping=new Map<string,Map<string,string>>();
 for(const [name,rows] of Object.entries(options.resume?.mappings||{}))
  mapping.set(name,new Map(Object.entries(rows)));
 const committed:BatchCommitted[]=[];
 let confirmed=0;
 const mapId=(table:string,sourceId:string)=>mapping.get(table)?.get(sourceId)||sourceId;
 for(let stageIndex=0;stageIndex<stages.length;stageIndex++){
  if(options.shouldStop?.())throw Error('Publicación batch detenida por el usuario; no se enviarán nuevos lotes.');
  const tasks:Array<{table:string;records:BatchChange[]}>=[],stage=stages[stageIndex];
  for(const table of stage){
   const rows=group.get(table)||[];
   for(let i=0;i<rows.length;i+=batchSize)tasks.push({table,records:rows.slice(i,i+batchSize)});
  }
  // Groups within a stage are independent by the dependency planner.
  // A wave dispatches at most N requests simultaneously. All in-flight
  // responses are accounted for before a failure halts the next wave.
  for(let start=0;start<tasks.length;start+=concurrency){
   if(options.shouldStop?.())throw Error('Publicación batch detenida antes del siguiente grupo de lotes.');
   const wave=tasks.slice(start,start+concurrency);
   const settle=await Promise.allSettled(wave.map(async task=>{
    const rows=task.records,table=task.table,columns=tables[table].columns;
    const parts=rows.map((op,index)=>{
     const original=records.get(table)!.get(op.id)!;
     const row={...original};
     for(const rel of relations[table]||[]){
      const val=String(row[rel.field]??'').trim();
      if(val)row[rel.field]=mapId(rel.target,val);
     }
     const payload=normalize(table,row,columns);
     if(op.action==='update')delete payload.id;
     return {id:'p'+(index+1),path:'/'+table+(op.action==='update'?'/'+op.id:''),
      operation:op.action,payload};
    });
    const json=await send(parts);
    if(!json||!Array.isArray(json.parts)||json.parts.length!==parts.length)
     throw Error('Oracle devolvió batch sin todas las partes; estado incierto. No reintentes sin verificar.');
    const byPart=new Map(json.parts.map(item=>[item.id,item]));
    const confirmedOps:BatchCommitted['operations']=[];
    for(let i=0;i<parts.length;i++){
     const expected=parts[i],source=rows[i],result=byPart.get(expected.id);
     if(!result||result.operation!==expected.operation||
       typeof result.status==='number'&&(result.status<200||result.status>=300)||result.error)
      throw Error('Oracle no confirmó la operación batch '+table+'/'+source.id+
       '. Verifica el lote antes de reintentar.');
     const oracleId=source.action==='update'?source.id:String(result.payload?.id??'').trim();
     if(!/^[A-Za-z0-9._~-]+$/.test(oracleId))
      throw Error('El batch no devolvió ID Oracle para '+table+' origen '+source.id+'. Verifica el registro antes de reintentar.');
     confirmedOps.push({sourceId:source.id,oracleId,action:source.action});
    }
    return {stage:stageIndex+1,table,ids:rows.map(x=>x.id),operations:confirmedOps};
   }));
   // All completed requests are recorded even if one request fails.
   const failures:unknown[]=[];
   for(const result of settle){
    if(result.status==='rejected'){failures.push(result.reason);continue;}
    const record=result.value;
    committed.push(record);confirmed+=record.operations.length;
    const perTable=mapping.get(record.table)||new Map<string,string>();
    mapping.set(record.table,perTable);
    for(const op of record.operations)perTable.set(op.sourceId,op.oracleId);
    options.onCommit?.(record);
   }
   if(failures.length){
    const message=failures.map(f=>f instanceof Error?f.message:String(f)).join(' | ');
    const err=new Error('Batch detenido en etapa '+(stageIndex+1)+'. '+message);
    Object.assign(err,{committed,confirmed,mappings:Object.fromEntries([...mapping].map(([k,v])=>[k,Object.fromEntries(v)]))});
    throw err;
   }
  }
 }
 return {confirmed,committed,mappings:Object.fromEntries([...mapping].map(([k,v])=>[k,Object.fromEntries(v)]))};
}
(globalThis as typeof globalThis & {ZPOTOracleBatchRunner?:{run:typeof executeOracleBatches}}).ZPOTOracleBatchRunner={run:executeOracleBatches};
