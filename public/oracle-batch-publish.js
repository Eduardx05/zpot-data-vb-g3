/* Optional batch publisher for two-ZIP differential merges.
 * Runs only after explicit OIC Development target confirmation.
 * Parent→child stages are sequential, independent batches bounded-parallel.
 * It never changes the V1 single-record publisher.
 */
(function(){
 'use strict';
 const ui=()=>window.ZPOTDualFusionUI;
 function report(message,error=false){
  const el=document.getElementById('fusion-batch-progress');
  if(el){el.textContent=message;el.className='notice'+(error?' danger':'');}
 }
 function info(){return ui()?.getBatchData();}
 function set(state,refresh=false){ui()?.updateBatch(state,refresh);}
 async function verify(){
  const ctx=info();
  if(!ctx?.delta||ctx.busy||ctx.preview?.totals.blocking)return report('Resuelve los conflictos antes de verificar GET.',true);
  set({batchChecked:false});
  try{
   const base=pubUrlTemplate(PUB.url);
   if(!pubIsConfirmedDevTarget(base))throw Error('Solo OIC Desarrollo está autorizado.');
   const names=Object.keys(ctx.delta.tables);
   if(!names.length)throw Error('No hay BO pendientes de publicación.');
   for(let i=0;i<names.length;i++){
    await pubFetch(pubEndpoint(base,names[i])+'?limit=1',{headers:{Accept:'application/json'}});
    if(i%5===0)report('Verificando GET: '+(i+1)+'/'+names.length+' BO.');
   }
   set({batchChecked:true},true);
   report('GET verificado para '+names.length+' BO. Listo para confirmar el envío batch.');
  }catch(e){set({batchChecked:false});report('GET no confirmado: '+e.message,true);}
 }
 function normalize(table,row,columns,relations){
  const known=new Map((KNOWN[table]?.fields||[]).map(x=>[x.name,x.type]));
  for(const rel of relations[table]||[])known.set(rel.field,'number');
  const body={};
  for(const column of columns){
   if(column!=='id'&&PUB_SYSTEM_FIELDS.has(column))continue;
   const val=row[column];if(val===undefined||val===null||val==='')continue;
   const type=known.get(column)||'';
   if(type==='boolean'&&/^(true|false|0|1)$/i.test(String(val)))
    body[column]=/^(true|1)$/i.test(String(val));
   else if((type==='number'||type==='integer'||column==='id')&&/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(String(val))){
    const num=Number(val);
    body[column]=(Number.isSafeInteger(num)||type==='number'&&Number.isFinite(num))?num:val;
   }else body[column]=val;
  }
  return body;
 }
 async function publish(){
  const ctx=info();
  if(!ctx||ctx.busy)return;
  if(!ctx.verified||!ctx.baselineConfirmed||ctx.destination!=='oracle'||
   !ctx.delta?.totals.totalWrites||ctx.preview?.totals.blocking)
   return report('Verifica el destino, confirma el ZIP A y resuelve los conflictos.',true);
  if(ctx.currentSignature!==ctx.signature)return report('Los ZIP cambiaron. Vuelve a analizar.',true);
  const typed=document.getElementById('fusion-batch-phrase')?.value?.trim();
  if(typed!=='CARGAR DESARROLLO')return report('Escribe CARGAR DESARROLLO exactamente.',true);
  if(ctx.report)return report('Hay un envío anterior registrado. Descarga su auditoría y concilia los IDs antes de otro intento.',true);
  const base=pubUrlTemplate(PUB.url);
  if(!pubIsConfirmedDevTarget(base))return report('Endpoint de Oracle no autorizado.',true);
  if(!window.ZPOTOracleBatchRunner)return report('Falta el módulo batch; ejecuta npm run build.',true);
  const stages=window.ZPOTDependencyPlanner(Object.keys(ctx.delta.tables),ctx.inputs.relations);
  if(stages.unplanned.length)return report('Dependencias bloqueantes: '+stages.unplanned.join(', '),true);
  const label='Confirmación de escritura real en OIC Desarrollo\n'+
   'ZIP A se conserva; se enviarán solo '+ctx.delta.totals.inserts+' registros nuevos y '+
   ctx.delta.totals.updates+' actualizaciones.\n'+
   'Batch de '+ctx.size+' y hasta '+ctx.concurrency+' solicitudes simultáneas.\n'+
   'No hay reintentos automáticos después de un error o timeout.\n¿Autorizar?';
  if(!window.confirm(label))return;
  const audit={
   format:'BNCR-ZPOT-ORACLE-BATCH-v1',startedAt:new Date().toISOString(),
   endpoint:base,sources:{existing:ctx.oldSha,incoming:ctx.newSha},
   configuration:{size:ctx.size,concurrency:ctx.concurrency},
   total:ctx.delta.totals.totalWrites,confirmed:0,
   batches:[],completed:{},mappings:{},status:'running'
  };
  set({batchBusy:true,batchStop:false,batchReport:audit});
  report('API batch: iniciando envío de '+audit.total+' registros diferenciales…');
  try{
   const result=await window.ZPOTOracleBatchRunner.run({
    changes:ctx.delta.operations,tables:ctx.delta.tables,relations:ctx.inputs.relations,
    stages:stages.stages,batchSize:ctx.size,concurrency:ctx.concurrency,
    normalize:(table,row,cols)=>normalize(table,row,cols,ctx.inputs.relations),
    shouldStop:()=>info()?.stop,
    onCommit:batch=>{
     audit.batches.push(batch);
     for(const op of batch.operations){
      (audit.completed[batch.table]??=[]).push(op.sourceId);
      (audit.mappings[batch.table]??={})[op.sourceId]=op.oracleId;
     }
     audit.confirmed+=batch.operations.length;
     report('Confirmados '+audit.confirmed+'/'+audit.total+' · etapa '+batch.stage+' · '+batch.table);
    },
    send:async parts=>{
     let response;
     try{
      response=await fetch('/api/oracle-batch',{
       method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',
       headers:{Accept:'application/vnd.oracle.adf.batch+json',
        'Content-Type':'application/vnd.oracle.adf.batch+json',
        'X-ZPOT-Request':'1','X-ZPOT-Write-Confirm':'CARGAR DESARROLLO'},
       body:JSON.stringify({parts})
      });
     }catch(e){throw Error('Respuesta batch incierta por problema de red. NO reintentar automáticamente: '+e.message);}
     const raw=await response.text();
     let json=null;try{json=JSON.parse(raw)}catch{}
     if(!response.ok)throw Error('Batch Oracle HTTP '+response.status+': '+
      String(json?.error||json?.detail||raw.slice(0,300)||response.statusText));
     return json;
    }
   });
   audit.status='completed';audit.finishedAt=new Date().toISOString();
   audit.mappings=result.mappings;
   report('Envío batch finalizado: '+audit.confirmed+' registros confirmados. Descarga la auditoría.');
  }catch(e){
   audit.status='needs-reconciliation';audit.stoppedAt=new Date().toISOString();
   audit.error=e.message;
   report('Batch detenido: '+e.message+'. Descarga la auditoría y revisa los IDs antes de reintentar.',true);
  }finally{
   set({batchBusy:false,batchStop:false});
   const btn=document.getElementById('fusion-batch-start');if(btn)btn.disabled=true;
   const stop=document.getElementById('fusion-batch-stop');if(stop)stop.disabled=true;
   const exportBtn=document.getElementById('fusion-batch-report');if(exportBtn)exportBtn.disabled=false;
  }
 }
 document.addEventListener('change',e=>{
  const x=e.target;if(section!=='fusionar')return;
  if(x.id==='fusion-batch-size')set({batchSize:Number(x.value),batchChecked:false});
  if(x.id==='fusion-batch-concurrency')set({batchConcurrency:Number(x.value)});
 });
 document.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button||section!=='fusionar')return;
  if(button.id==='fusion-batch-verify')verify();
  if(button.id==='fusion-batch-start')publish();
  if(button.id==='fusion-batch-stop'){
   set({batchStop:true});report('Se detendrá al terminar los lotes actualmente en vuelo.');
  }
  if(button.id==='fusion-batch-report'){
   const data=info()?.report;if(data)downloadJSON('BNCR_API_BATCH_AUDITORIA_'+new Date().toISOString().slice(0,10)+'.json',data);
  }
 });
 window.ZPOTOracleBatchPublish={verify,publish};
})();
