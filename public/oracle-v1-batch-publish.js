/* Publicador V1 con Oracle ADF batch y concurrencia acotada.
 * Reutiliza el mismo plan, consolidación, seguridad, mapeo de IDs y prevalidaciones.
 * No modifica el publicador secuencial de V1 ni realiza reintentos ambiguos.
 */
(function(){
 'use strict';
 const FORMAT='BNCR-ZPOT-V1-ORACLE-BATCH-v1';
 const B={size:10,concurrency:2,busy:false,stop:false,audit:null,session:null};
 const idPattern=/^[A-Za-z0-9._~-]+$/;
 function fingerprint(){return JSON.stringify({v1:pubRecoveryFingerprint(),size:B.size,concurrency:B.concurrency});}
 function show(msg,error=false){
  pubSetStatus(msg,error?'danger':'ok');
  const el=document.getElementById('v1batch-status');
  if(el){el.textContent=msg;el.className='notice'+(error?' danger':'');}
  pubLog(msg);
 }
 function syncButtons(){
  const status=B.audit?.status;
  const report=document.getElementById('pub-report');
  if(report)report.disabled=!B.audit;
  const save=document.getElementById('pub-save-checkpoint');
  if(save)save.disabled=!B.audit||B.busy;
  const send=document.getElementById('pub-send');
  if(send){send.disabled=B.busy||status==='completed'||status==='needs-reconciliation';send.textContent=status==='paused'?'Continuar publicación batch':'Enviar lotes en paralelo a Oracle';}
  const stop=document.getElementById('pub-stop');
  if(stop)stop.disabled=!B.busy;
 }
 function render(){
  let html=renderPublish().replace('Publicar consolidado por API','Publicar Oracle con batch y paralelo')
   .replace('Las solicitudes se envían secuencialmente al proxy local Node.js','Las solicitudes se envían en lotes ADF al proxy local Node.js, con concurrencia limitada')
   .replace('Enviar registros seleccionados por API','Enviar lotes en paralelo a Oracle')
   .replace('Detener tras solicitud actual','Detener tras los lotes en curso')
   .replace('Si Oracle genera nuevos IDs, las referencias entre objetos no se reasignan automáticamente:', 'Los IDs Oracle confirmados se reasignan en los hijos de etapas posteriores:');
  const controls=block('Publicación Oracle batch y paralelo · Copia funcional de V1',
   '<div class="notice"><strong>Modo independiente de la V1 secuencial.</strong> Conserva selección de ZIP y Business Objects, filtros, límites, relaciones, previsualización, IDs y auditoría. Envía hasta 25 operaciones por lote ADF y 1–3 lotes en paralelo; solo avanza a una nueva etapa cuando termina la anterior. Para referencias entre filas nuevas del mismo BO utiliza el publicador secuencial V1.</div>'+
   '<div class="settings-grid"><label>Registros por lote<select id="v1batch-size">'+
    [5,10,25].map(n=>'<option value="'+n+'" '+(B.size===n?'selected':'')+'>'+n+(n===10?' · recomendado':'')+'</option>').join('')+
   '</select></label><label>Lotes simultáneos<select id="v1batch-concurrency">'+
    [1,2,3].map(n=>'<option value="'+n+'" '+(B.concurrency===n?'selected':'')+'>'+n+(n===2?' · recomendado':'')+'</option>').join('')+
   '</select></label></div>'+
   '<div class="notice"><strong>Importante:</strong> el modo batch admite sincronización por ID (GET → PATCH/POST), solo PATCH y POST de creación. Upsert-Mode no está disponible en la API batch. Una fila conflictiva puede invalidar todo su lote: se detiene y se requiere conciliación, aunque en V1 esté habilitada la omisión de errores. No hay reintentos automáticos ni rollback entre lotes.</div>'+
   '<div class="actions"><button class="btn" id="v1batch-import" '+(B.busy?'disabled':'')+'>Importar auditoría batch pausada</button><input type="file" id="v1batch-file" accept=".json,application/json" hidden/><button class="btn" id="v1batch-export" '+(B.audit?'':'disabled')+'>Descargar auditoría batch</button></div>'+
   '<div id="v1batch-status" class="notice">'+(B.audit?'Confirmados: '+fmt(B.audit.confirmed)+' / '+fmt(B.audit.total)+'; etapa siguiente '+(B.audit.nextStage+1)+'; estado '+esc(B.audit.status):'Sin operaciones batch enviadas.')+'</div>');
  html=html.replace('<section class="panel">',controls+'<section class="panel">');
  if(!B.audit)html=html.replace(/(<button[^>]*id="pub-report")[^>]*>/,'$1 disabled>');
  if(B.audit)html=html.replace(/(<button[^>]*id="pub-save-checkpoint")[^>]*>/,'$1>');
  return html;
 }
 async function buildSession(audit){
  const plan=pubGetPlan(),packs=new Map();
  if(plan.unplanned.length)throw Error('Dependencias sin orden seguro: '+plan.unplanned.join(', '));
  for(const table of plan.order){
   const pack=await pubConsolidated(table);
   pack.rows=window.ZPOTOracleIdTools.sortSelfRows(table,pack.rows,pubRelationships([table])[table]||[]);
   if(pack.rows.some(r=>!idPattern.test(String(r.id??'').trim())))
    throw Error('Batch necesita un ID de origen válido en todas las filas de '+table+'. Usa V1 secuencial para filas sin ID.');
   packs.set(table,pack);
  }
  if(!packs.size)throw Error('Selecciona Business Objects con registros.');
  const rowCounts=Object.fromEntries([...packs].map(([t,p])=>[t,p.rows.length]));
  if(audit){
   if(JSON.stringify(audit.rowCounts)!==JSON.stringify(rowCounts)||
      JSON.stringify(audit.plan)!==JSON.stringify(plan.stages))
    throw Error('El esquema, los conteos o el plan difieren de la auditoría batch.');
  }
  const idMap=window.ZPOTOracleIdTools.createRegistry();
  if(PUB.restoredMappings)idMap.load(PUB.restoredMappings);
  if(audit?.idMappings)idMap.load(audit.idMappings);
  const session={plan,packs,idMap,checkedReferences:new Set(),successfulIds:new Map(),
   skippedIds:new Map(),report:{skippedRecords:[]},stageIndex:audit?.nextStage||0};
  if(audit){
   for(const [t,ids] of Object.entries(audit.completed||{}))session.successfulIds.set(t,new Set(ids));
   for(const item of audit.skippedRecords||[]){
    if(!session.skippedIds.has(item.object))session.skippedIds.set(item.object,new Set());
    session.skippedIds.get(item.object).add(item.id);
   }
  }
  return {session,rowCounts};
 }
 async function classify(table,row,session,base){
  const id=String(row.id).trim(),mapped=session.idMap.get(table,id),payload=pubPayload(table,row,session.packs.get(table).cols);
  if(PUB.mode==='create')return {object:table,id,action:'create',changedFields:[]};
  const target=mapped||id;
  let exists=false;
  try{await pubFetch(pubEndpoint(base,table,target));exists=true;}
  catch(error){if(error.status!==404)throw error;if(mapped)throw Error('El ID Oracle recuperado para '+table+'/'+id+' ('+target+') ya no existe; no crear duplicados.');}
  if(PUB.mode==='update'){
   if(!exists)throw Error('Solo PATCH: falta el registro '+table+'/'+target+' en Oracle.');
   return {object:table,id,targetId:String(target),action:'update',changedFields:[]};
  }
  if(exists)return {object:table,id,targetId:String(target),action:'update',changedFields:[]};
  const found=await pubFindUnique(table,payload,base);
  if(found){
   const owner=session.idMap.ownerOf(table,found.id);
   if(owner&&owner!==id)throw Error('Conflicto de IDs para '+table+': Oracle '+found.id+' ya está vinculado al origen '+owner);
   session.idMap.put(table,id,found.id);
   await pubFetch(pubEndpoint(base,table,found.id));
   return {object:table,id,targetId:String(found.id),action:'update',changedFields:[]};
  }
  return {object:table,id,action:'create',changedFields:[]};
 }
 async function send(parts){
  let response;
  try{response=await fetch('/api/oracle-batch',{
   method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',
   headers:{Accept:'application/vnd.oracle.adf.batch+json','Content-Type':'application/vnd.oracle.adf.batch+json',
    'X-ZPOT-Request':'1','X-ZPOT-Write-Confirm':'CARGAR DESARROLLO'},
   body:JSON.stringify({parts})
  });}catch(error){throw Error('Estado del lote incierto por fallo de red: '+error.message+'. NO reintentar.');}
  const raw=await response.text();
  let data=null;try{data=JSON.parse(raw);}catch{}
  if(!response.ok)throw Error('Batch HTTP '+response.status+': '+String(data?.error||data?.detail||raw.slice(0,250)||response.statusText));
  return data;
 }
 function appendSkip(session,audit,table,row,error,stage){
  const id=String(row.id).trim();
  if(!session.skippedIds.has(table))session.skippedIds.set(table,new Set());
  if(session.skippedIds.get(table).has(id))return;
  session.skippedIds.get(table).add(id);
  const item=pubIssueDetails(table,row,error,stage+1);
  audit.skippedRecords.push(item);audit.skipped++;
  pubLog('⚠ Omitido en prevalidación '+table+'/'+id+': '+item.message);
 }
 function addCommit(session,audit,stage,record){
  const entry={stage:stage+1,table:record.table,ids:record.ids,operations:record.operations};
  audit.batches.push(entry);
  for(const op of record.operations){
   (audit.completed[record.table]??=[]).push(op.sourceId);
   session.idMap.put(record.table,op.sourceId,op.oracleId);
   if(!session.successfulIds.has(record.table))session.successfulIds.set(record.table,new Set());
   session.successfulIds.get(record.table).add(op.sourceId);
   audit.confirmed++;audit.success++;
   if(op.action==='create')audit.created++;else audit.updated++;
   audit.operations.push({stage:stage+1,object:record.table,originalId:op.sourceId,
    oracleId:op.oracleId,operation:op.action==='create'?'created':'updated'});
  }
  audit.idMappings=session.idMap.snapshot();
  const bar=document.getElementById('pub-progress');
  if(bar)bar.style.width=(100*(audit.confirmed+audit.skipped)/Math.max(1,audit.total)).toFixed(1)+'%';
  show('Confirmados '+audit.confirmed+'/'+audit.total+' · etapa '+(stage+1)+' · '+record.table);
 }
 async function stageRun(session,audit,stage,base){
  const names=session.plan.stages[stage],rowsByTable={},changes=[],relations=pubRelationships(names);
  // Verificar todas las colecciones antes de la primera escritura de la etapa.
  for(const t of names)await pubFetch(pubEndpoint(base,t)+'?limit=1');
  const already=new Set(Object.entries(audit.completed).flatMap(([t,ids])=>ids.map(id=>t+'/'+id)));
  for(const t of names){
   const pack=session.packs.get(t),operations=[];
   rowsByTable[t]={columns:pack.cols,rows:pack.rows};
   for(const row of pack.rows){
    if(B.stop)throw Error('Publicación batch detenida por el usuario.');
    const id=String(row.id).trim();
    if(already.has(t+'/'+id)||session.skippedIds.get(t)?.has(id))continue;
    const payload=pubPayload(t,row,pack.cols);
    for(const rel of relations[t]||[])
     if(String(row[rel.field]??'').trim()&&!Object.hasOwn(payload,rel.field))
      throw Error('FK fuera del esquema: '+t+'.'+rel.field+'. Revisa esquema de publicación.');
    operations.push(await classify(t,row,session,base));
   }
   changes.push(...operations);
  }
  // Las filas ya existentes en Oracle pueden servir como padres durante la
  // prevalidación; no se consideran confirmadas hasta que el batch responde.
  const temporary=[];
  for(const change of changes)if(change.action==='update'){
   const t=change.object;
   if(!session.successfulIds.has(t))session.successfulIds.set(t,new Set());
   const set=session.successfulIds.get(t);
   if(!set.has(change.id)){temporary.push([t,change.id]);set.add(change.id);}
  }
  try{
   const newKeys=new Set(changes.filter(x=>x.action==='create').map(x=>x.object+'/'+x.id));
   for(const op of changes){
    const pack=session.packs.get(op.object),row=pack.rows.find(r=>String(r.id).trim()===op.id);
    for(const rel of relations[op.object]||[]){
     const id=String(row[rel.field]??'').trim();
     if(id&&rel.target===op.object&&newKeys.has(rel.target+'/'+id))
      throw Error('Dependencia entre filas nuevas del mismo BO: '+op.object+'/'+op.id+' → '+id+'. Ejecutar este BO en la V1 secuencial.');
    }
   }
   const safe=[];
   for(const op of changes){
    if(B.stop)throw Error('Publicación batch detenida por el usuario.');
    const pack=session.packs.get(op.object),row=pack.rows.find(r=>String(r.id).trim()===op.id);
    try{await pubCheckRowReferences(pack,row,session,base);safe.push(op);}
    catch(error){
     if(PUB.skipConflicts&&pubCanSkipIssue(error))appendSkip(session,audit,op.object,row,error,stage);
     else throw error;
    }
   }
   if(!safe.length)return;
   const runner=window.ZPOTOracleBatchRunner;
   if(!runner)throw Error('No está cargado el motor de lotes Oracle.');
   await runner.run({
    changes:safe,tables:rowsByTable,relations,stages:[names],
    batchSize:B.size,concurrency:B.concurrency,normalize:(t,row,cols)=>pubPayload(t,row,cols),
    resume:{completed:{},mappings:session.idMap.snapshot()},
    shouldStop:()=>B.stop,send,
    onCommit:record=>addCommit(session,audit,stage,record)
   });
  }finally{
   for(const [t,id] of temporary){
    if(!audit.completed[t]?.includes(id))session.successfulIds.get(t)?.delete(id);
   }
  }
 }
 async function publish(){
  if(B.busy||PUB.busy)return;
  pubFromInputs();
  try{
   const base=pubUrlTemplate(PUB.url),plan=pubGetPlan();
   if(!pubIsConfirmedDevTarget(base))throw Error('Solo se permite OIC Desarrollo Gen 3 V2.');
   if(!PUB.testPassed||PUB.testedUrl!==base||PUB.testedAuth!==PUB.auth)
    throw Error('Primero comprueba el GET del destino Oracle.');
   if(!PUB.approved||document.getElementById('pub-confirm-phrase')?.value!=='CARGAR DESARROLLO')
    throw Error('Confirma el respaldo y escribe CARGAR DESARROLLO.');
   if(PUB.mode==='upsert')throw Error('Upsert-Mode no se admite en Oracle ADF batch. Utiliza sincronización por ID.');
   if(PUB.mode!=='create'&&!PUB.preserveIds)throw Error('PATCH/sync requiere conservar IDs de origen.');
   if(!plan.stages.length||plan.unplanned.length)throw Error('El plan no contiene etapas seguras.');
   if(B.audit?.status==='completed'||B.audit?.status==='needs-reconciliation')
    throw Error('La auditoría anterior no es reanudable. Descárgala, concilia Oracle y restablece el plan.');
   if(B.audit?.fingerprint!==undefined&&B.audit.fingerprint!==fingerprint())
    throw Error('Cambió el plan/configuración respecto al intento anterior; descarga la auditoría antes de restablecer.');
   if(PUB.limit==='ALL'&&!window.confirm('Se publicarán TODOS los registros de los BO seleccionados. ¿Confirmas el respaldo y ambiente aislado?'))return;
   if(!window.confirm('ESCRITURA REAL EN ORACLE DESARROLLO\nModo '+PUB.mode+'\n'+B.size+
     ' registros por lote; hasta '+B.concurrency+' lotes simultáneos.\n'+
     'Solo se paralelizan operaciones sin dependencia padre-hijo.\nNo hay reintento automático ante resultados inciertos.\n¿Autorizar publicación?'))return;
   B.busy=true;PUB.busy=true;B.stop=false;syncButtons();
   if(!B.session){
    const built=await buildSession(null);
    B.session=built.session;
    B.audit={format:FORMAT,startedAt:new Date().toISOString(),url:base,fingerprint:fingerprint(),
     sourceHashes:[...consolidation].map(i=>String(D[i].sha)).sort(),plan:plan.stages,
     rowCounts:built.rowCounts,mode:PUB.mode,configuration:{size:B.size,concurrency:B.concurrency},
     total:Object.values(built.rowCounts).reduce((a,b)=>a+b,0),confirmed:0,success:0,
     created:0,updated:0,skipped:0,completed:{},skippedRecords:[],batches:[],operations:[],
     idMappings:B.session.idMap.snapshot(),nextStage:0,status:'running'};
   }
   const audit=B.audit,session=B.session;
   audit.status='running';audit.resumedAt=new Date().toISOString();
   const end=pubStageEnd(session.stageIndex,session.plan.stages.length,PUB.stepMode,PUB.autoStartNext);
   for(let stage=session.stageIndex;stage<end;stage++){
    if(B.stop)throw Error('Publicación batch detenida por el usuario.');
    show('Preparando y validando etapa '+(stage+1)+'/'+session.plan.stages.length+'...');
    await stageRun(session,audit,stage,base);
    session.stageIndex=stage+1;audit.nextStage=session.stageIndex;
    audit.idMappings=session.idMap.snapshot();
   }
   audit.status=session.stageIndex===session.plan.stages.length?'completed':'paused';
   audit.safeToResume=audit.status==='paused';
   audit.finishedAt=new Date().toISOString();
   show(audit.status==='completed'?'Batch finalizado: '+audit.success+' confirmados; '+audit.skipped+' omitidos. Descarga la auditoría.':
    'Etapa terminada. '+audit.success+' confirmados; siguiente etapa '+(audit.nextStage+1)+'.');
  }catch(error){
   if(B.audit){
    const paused=B.stop&&/detenida por el usuario/.test(error.message);
    B.audit.status=paused?'paused':'needs-reconciliation';
    B.audit.safeToResume=paused;
    B.audit.error=error.message;B.audit.pausedAt=new Date().toISOString();
    B.audit.idMappings=B.session?.idMap.snapshot()||B.audit.idMappings;
   }
   show('Batch detenido: '+error.message+'. '+(B.audit?.safeToResume?'Puedes continuar los lotes pendientes.':'Estado no reanudable automáticamente; revisa Oracle y los IDs confirmados.'),true);
  }finally{B.busy=false;PUB.busy=false;B.stop=false;syncButtons();}
 }
 function exportAudit(){
  if(!B.audit)return show('No hay auditoría batch.',true);
  downloadJSON('BNCR_V1_BATCH_ORACLE_AUDITORIA_'+new Date().toISOString().slice(0,10)+'.json',B.audit);
 }
 function validateAudit(audit){
  if(!audit||audit.format!==FORMAT||audit.status!=='paused'||audit.safeToResume!==true)
   throw Error('Solo puede importarse una auditoría batch pausada de forma segura.');
  if(audit.url!==pubUrlTemplate(PUB.url)||audit.fingerprint!==fingerprint()||
   JSON.stringify(audit.sourceHashes)!==JSON.stringify([...consolidation].map(i=>String(D[i].sha)).sort()))
   throw Error('Destino, ZIP, esquema o configuración no coinciden con la auditoría.');
  const plan=pubGetPlan();
  if(JSON.stringify(audit.plan)!==JSON.stringify(plan.stages)||!Number.isInteger(audit.nextStage)||
   audit.nextStage<0||audit.nextStage>=plan.stages.length)
   throw Error('Plan de dependencias o etapa inválida en el JSON.');
  const seen=new Set(),completed={},validTables=new Set(plan.order);let count=0;
  for(const batch of audit.batches||[]){
   if(!validTables.has(batch.table)||!Array.isArray(batch.ids)||!Array.isArray(batch.operations)||
    batch.ids.length!==batch.operations.length)throw Error('Lote inválido en la auditoría.');
   for(let i=0;i<batch.operations.length;i++){
    const op=batch.operations[i],key=batch.table+'/'+op.sourceId;
    if(op.sourceId!==batch.ids[i]||!idPattern.test(String(op.sourceId))||
     !idPattern.test(String(op.oracleId))||seen.has(key))throw Error('Registro duplicado/inválido: '+key);
    seen.add(key);(completed[batch.table]??=[]).push(op.sourceId);count++;
    if(String(audit.idMappings?.[batch.table]?.[op.sourceId])!==String(op.oracleId))
     throw Error('El mapa Oracle no coincide con un lote confirmado.');
   }
  }
  if(count!==audit.confirmed||count!==audit.success||
   JSON.stringify(completed)!==JSON.stringify(audit.completed))
   throw Error('Confirmaciones de lote incompatibles con el checkpoint.');
  const omissions=new Set();
  for(const issue of audit.skippedRecords||[]){
   const key=issue.object+'/'+issue.id;
   if(!validTables.has(issue.object)||!idPattern.test(String(issue.id))||
    seen.has(key)||omissions.has(key))throw Error('Omisión inválida en auditoría: '+key);
   omissions.add(key);
  }
  if(omissions.size!==audit.skipped)throw Error('La auditoría no contiene todas las omisiones.');
  return audit;
 }
 async function importAudit(file){
  if(B.busy||PUB.busy||B.audit)throw Error('Restablece la sesión actual antes de cargar una auditoría.');
  if(file.size>75*1024*1024)throw Error('Archivo demasiado grande.');
  const raw=validateAudit(JSON.parse(await file.text()));
  const built=await buildSession(raw);
  B.audit=raw;B.session=built.session;PUB.testPassed=false;PUB.approved=false;
  render();
  show('Auditoría recuperada: '+raw.confirmed+' confirmados; verifica GET y autoriza la continuación.');
 }
 function reset(){
  if(B.busy)return;
  if(B.audit?.confirmed&&!window.confirm('Ya se publicaron '+B.audit.confirmed+' registros. Restablecer NO revierte Oracle. ¿Continuar?'))return;
  B.audit=null;B.session=null;B.stop=false;PUB.approved=false;
  render();
  show('Plan batch restablecido sin modificar Oracle.');
 }
 function stop(){B.stop=true;PUB.stop=true;show('Detención solicitada: finalizarán los lotes actualmente en vuelo.');}
 document.addEventListener('change',e=>{
  if(section!=='publicar-batch')return;
  const x=e.target;
  if(x.id==='v1batch-size'||x.id==='v1batch-concurrency'){
   if(B.audit){x.value=x.id==='v1batch-size'?B.size:B.concurrency;show('Restablece el plan antes de modificar el tamaño o concurrencia.',true);return;}
   const n=Number(x.value);
   if(x.id==='v1batch-size')B.size=n;else B.concurrency=n;
  }
  if(x.id==='v1batch-file'){
   const file=x.files?.[0];if(file)importAudit(file).catch(err=>show(err.message,true)).finally(()=>x.value='');
  }
 });
 document.addEventListener('click',e=>{
  if(section!=='publicar-batch')return;
  const btn=e.target.closest('button');
  if(btn?.id==='v1batch-export')exportAudit();
  if(btn?.id==='v1batch-import')document.getElementById('v1batch-file')?.click();
 });
 window.ZPOTV1BatchPublish={render,publish,stop,reset,exportAudit,importAudit,state:B};
})();