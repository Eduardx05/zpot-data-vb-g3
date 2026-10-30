/* ZPOT | Fusión de dos aplicaciones Oracle. Independent of the v1 publisher.
   Runs locally against ZIPs already loaded by the explorer. */
(function(){
 'use strict';
 const F={oldIndex:-1,newIndex:-1,preview:null,delta:null,inputs:null,decisions:{},signature:'',busy:false,destination:'zip',filter:'',issuesOnly:false,detailTable:'',baselineConfirmed:false,issueSearch:'',issueSeverity:'all',issuePage:0,issueShowResolved:true,bulkTable:''};
 const safe=(value)=>esc(String(value??''));
 const name=(index)=>D[index]?nominal(D[index]):'No seleccionado';
 const choices=(current,exclude)=>'<option value="-1">Selecciona un ZIP…</option>'+
   D.map((d,i)=>({d,i})).filter(x=>!x.d.isDemo&&x.i!==exclude).map(({d,i})=>
    '<option value="'+i+'" '+(current===i?'selected':'')+'>'+safe(d.filename)+' · '+fmt(stats(d).totalRows)+' filas</option>').join('');
 const signature=()=>JSON.stringify([D[F.oldIndex]?.sha,D[F.newIndex]?.sha]);
 const valid=()=>Number.isInteger(F.oldIndex)&&Number.isInteger(F.newIndex)&&F.oldIndex>=0&&F.newIndex>=0&&
  F.oldIndex!==F.newIndex&&D[F.oldIndex]&&!D[F.oldIndex].isDemo&&D[F.newIndex]&&!D[F.newIndex].isDemo;
 function ruleLabel(policy){return {
  'catalog-old':'Catálogos existentes → conservar; nuevos → incorporar',
  cases:'Cases existentes → conservar; nuevos → agregar o actualizar por oportunidad',
  configuration:'Configuration: aplicar valores con fecha posterior verificable',
  operations:'Operación e historiales: preservar ambas versiones'
 }[policy]||policy;}
 function status(message,error){
  const el=document.getElementById('fusion-status');
  if(el){el.textContent=message;el.className='notice'+(error?' danger':'');}
 }
 function renderFusion(){
  const good=valid(),result=F.preview&&F.signature===signature()?F.preview:null;
  const note='<div class="notice"><strong>Flujo independiente.</strong> Esta página no cambia la publicación existente. Los dos ZIP se leen localmente; se crea un tercer ZIP y su auditoría sin modificar los originales ni escribir en Oracle. Los conflictos de identidad y las referencias sin resolver bloquean el envío directo.</div>';
  let html=pagehead('Consolidar ZIP existente en Oracle + ZIP de cambios','Marca qué ZIP ya está cargado en Oracle. El otro ZIP solo incorporará nuevos registros o actualizará diferencias verificables, sin recargar los históricos.')+note;
  html+=block('1 · Elegir las dos aplicaciones',`
   <div class="settings-grid">
    <label>ZIP A · Ya existe en Oracle (conservar los IDs actuales)<select id="fusion-old">${choices(F.oldIndex,F.newIndex)}</select></label>
    <label>ZIP B · Agregar o actualizar solo lo necesario<select id="fusion-new">${choices(F.newIndex,F.oldIndex)}</select></label>
   </div>
   <div class="actions"><button class="btn" id="fusion-add">＋ Cargar uno o dos ZIP adicionales</button></div>
   <label class="check-inline"><input type="checkbox" id="fusion-baseline-confirm" ${F.baselineConfirmed?'checked':''}/> Confirmo que el ZIP A es una exportación del Oracle Live DESTINO donde se conservarán los IDs; sus registros existentes NO se volverán a publicar si no cambiaron.</label>
    <p class="micro">La marca indica lo que tú confirmas, no una comprobación de estado en tiempo real. Si Oracle cambió después de exportar el ZIP A, actualiza ese ZIP antes de generar el diferencial. No se aceptan ZIP DEMO.</p>`);
  html+=block('2 · Reglas de fusión',`
   <div class="fusion-rules">
    <div><strong>Catálogos</strong><small>ZIP A conserva todos sus IDs. ZIP B solo incorpora valores nuevos o completa coincidencias verificadas.</small></div>
    <div><strong>Cases</strong><small>Los 14,000 casos del ZIP A no se reenvían si no cambiaron. Los de ZIP B se agregan o actualizan por opportunityNumber verificable.</small></div>
    <div><strong>Configuration</strong><small>Actualizar solo los campos que cambiaron cuando la fecha del ZIP B sea posterior; conservar los IDs del destino.</small></div>
    <div><strong>Historiales y etapas</strong><small>No modificar los existentes de ZIP A. Registrar nuevas filas de ZIP B y validar la identidad de cada referencia.</small></div>
   </div>
   <div class="actions"><button class="btn btn-primary" id="fusion-analyze" ${!good||F.busy?'disabled':''}>Analizar y generar vista previa</button></div>
   <div id="fusion-status" class="notice">${F.busy?'Analizando tablas de los dos ZIP…':result?'Análisis completado. Revisa los conflictos y selecciona el destino.':'Selecciona ambos ZIP para comenzar.'}</div>`);
  if(result){
   const m=result.totals,d=F.delta?.totals||{existing:0,unchanged:0,updates:0,inserts:0,totalWrites:0};
   html+=block('3 · Resultado previo',`
    <div class="metrics">
     <div class="metric"><div class="metric-label">Filas en ZIP antiguo</div><div class="metric-number">${fmt(m.old)}</div></div>
     <div class="metric"><div class="metric-label">Filas en ZIP nuevo</div><div class="metric-number">${fmt(m.new)}</div></div>
     <div class="metric"><div class="metric-label">Filas consolidadas</div><div class="metric-number">${fmt(m.result)}</div></div>
     <div class="metric"><div class="metric-label">Incidencias bloqueantes</div><div class="metric-number">${fmt(m.blocking)}</div></div>
    </div>
    <div class="chips">${badge(fmt(m.added)+' nuevas','teal')} ${badge(fmt(m.matched)+' conciliadas','ok')} ${badge(fmt(m.collisions)+' IDs reasignados','amber')} ${badge(fmt(m.missingReferences)+' referencias sin resolver',m.missingReferences?'danger':'ok')}</div>
    <div class="notice"><strong>Publicación diferencial — no volver a cargar el ZIP A.</strong>
    ${fmt(d.existing)} filas del ZIP A identificadas como existentes. ${fmt(d.unchanged)} permanecen sin cambios.
    Solo hay que preparar <strong>${fmt(d.inserts)} inserciones</strong> y <strong>${fmt(d.updates)} actualizaciones</strong>
    (${fmt(d.totalWrites)} escrituras), en lugar de republicar todo el ZIP consolidado.</div>
    <details><summary>Ver operaciones diferenciales por BO</summary><div class="table-wrap"><table><thead><tr><th>BO</th><th>Ya en Oracle</th><th>Sin cambio</th><th>PATCH</th><th>POST</th></tr></thead><tbody>
     ${(F.delta?.report||[]).filter(x=>x.updates||x.inserts).map(x=>'<tr><td>'+safe(x.object)+'</td><td>'+fmt(x.baseline)+'</td><td>'+fmt(x.unchanged)+'</td><td>'+fmt(x.updates)+'</td><td>'+fmt(x.inserts)+'</td></tr>').join('')}
    </tbody></table></div></details>
    ${m.blocking?'<div class="notice danger"><strong>Existen incidencias que requieren revisión.</strong> Se permite exportar un ZIP de diagnóstico, pero no prepararlo para publicación hasta resolver las referencias y los conflictos.</div>':'<div class="notice success"><strong>Prevalidación sin errores bloqueantes.</strong> Revisa igualmente las reglas de identidad y el esquema del destino antes de publicar.</div>'}
    <div class="search-line"><input id="fusion-filter" placeholder="Filtrar BO por nombre" value="${safe(F.filter)}"/><label class="check-inline"><input id="fusion-only-issues" type="checkbox" ${F.issuesOnly?'checked':''}/> Solo con incidencias</label></div>
    <div id="fusion-tables">${tablesHtml(result)}</div>
    <label class="block-label">Previsualizar filas y columnas de un BO
     <select id="fusion-detail-object">${result.reports.map(r=>'<option value="'+safe(r.name)+'" '+((F.detailTable||result.reports[0]?.name)===r.name?'selected':'')+'>'+safe(r.name)+' · '+fmt(r.resultRows)+' filas</option>').join('')}</select>
    </label>
    <div id="fusion-detail-result">${detailHtml(result)}</div>
    <div id="fusion-issues">${issuesHtml(result)}</div>`);
   html+=block('4 · Elegir destino y preparar entrega',`
     <label class="block-label">¿Dónde depositar el consolidado?
      <select id="fusion-destination">
       <option value="zip" ${F.destination==='zip'?'selected':''}>Descargar ZIP + auditoría JSON para revisión y Data Manager</option>
       <option value="oracle" ${F.destination==='oracle'?'selected':''}>Preparar envío a OIC Desarrollo mediante el publicador actual</option>
      </select>
     </label>
     <div class="notice">${F.destination==='oracle'?'<strong>Destino permitido:</strong> OIC Desarrollo (Live de desarrollo). Solo se traspasa el ZIP diferencial. El ZIP A queda intacto; se abrirá el publicador existente con confirmación y GET de prueba, sin enviar nada directamente.':'<strong>Exportación local:</strong> descarga el ZIP consolidado completo para revisión o el ZIP diferencial con SOLO las filas a insertar/actualizar. El último es el preparado para el publicador; no uses Data Manager en modo reemplazo para esta tarea.'}</div>
     <div class="actions">
      <button class="btn" id="fusion-download" ${F.busy?'disabled':''}>ZIP consolidado completo${m.blocking?' (diagnóstico)':''}</button>
      <button class="btn btn-primary" id="fusion-download-delta" ${F.busy||!F.delta?.totals.totalWrites?'disabled':''}>ZIP diferencial (solo POST/PATCH)${m.blocking?' — revisión':''}</button>
      <button class="btn" id="fusion-json" ${F.busy?'disabled':''}>Auditoría JSON + decisiones</button>
      ${F.destination==='oracle'?'<button class="btn btn-primary" id="fusion-publish" '+(m.blocking||F.busy||!F.baselineConfirmed||!F.delta?.totals.totalWrites?'disabled':'')+'>Preparar solo cambios en Oracle</button>':''}
     </div>
     <p class="footnote">La publicación es una operación separada. El ZIP generado no borra datos y no implica que los conflictos de unicidad del destino estén resueltos; el publicador debe validarlos contra Oracle.</p>`);
  }
  return html;
 }
 function issuesHtml(result){
  const items=result.issues.filter(i=>
   (F.issueShowResolved||!i.resolved)&&
   (F.issueSeverity==='all'||i.severity===F.issueSeverity)&&
   (!F.issueSearch||[i.table,i.id,i.message,i.source].some(value=>String(value).toLowerCase().includes(F.issueSearch.toLowerCase()))));
  const size=35,pages=Math.max(1,Math.ceil(items.length/size));
  F.issuePage=Math.min(Math.max(0,F.issuePage),pages-1);
  const slice=items.slice(F.issuePage*size,(F.issuePage+1)*size);
  const tables=[...new Set(result.issues.filter(i=>i.kind==='collision'&&i.source==='new').map(i=>i.table))].sort();
  return '<div class="fusion-review">'+
   '<h3>Conciliar incidencias · '+fmt(result.issues.length)+' detectadas</h3>'+
   '<p class="micro">Las acciones modifican la consolidación real. Los IDs del ZIP A se mantienen protegidos. Para conflictos de referencias, selecciona el ID de un padre que exista en el resultado consolidado.</p>'+
   '<div class="settings-grid">'+
    '<label>Buscar BO, ID o motivo<input id="fusion-issue-search" placeholder="Buscar incidencias" value="'+safe(F.issueSearch)+'"/></label>'+
    '<label>Tipo de incidencia<select id="fusion-issue-severity"><option value="all" '+(F.issueSeverity==='all'?'selected':'')+'>Todas</option><option value="blocking" '+(F.issueSeverity==='blocking'?'selected':'')+'>Bloqueantes</option><option value="warning" '+(F.issueSeverity==='warning'?'selected':'')+'>Advertencias</option></select></label>'+
   '</div>'+
   '<label class="check-inline"><input type="checkbox" id="fusion-issue-resolved" '+(F.issueShowResolved?'checked':'')+'/> Mostrar también las ya resueltas</label>'+
   '<div class="fusion-bulk"><label>Resolver varias colisiones de un BO</label><select id="fusion-bulk-table"><option value="">Selecciona BO…</option>'+
    tables.map(t=>'<option value="'+safe(t)+'" '+(F.bulkTable===t?'selected':'')+'>'+safe(t)+'</option>').join('')+
   '</select><button class="btn" id="fusion-bulk-both" '+(!F.bulkTable?'disabled':'')+'>Conservar ambas versiones (reasignar IDs)</button>'+
   '<button class="btn" id="fusion-bulk-skip" '+(!F.bulkTable?'disabled':'')+'>Omitir duplicados del ZIP B</button></div>'+
   '<div class="footnote">'+fmt(items.length)+' incidencias filtradas · página '+(F.issuePage+1)+' de '+pages+'</div>'+
   '<div class="table-wrap"><table><thead><tr><th>Severidad</th><th>BO / origen</th><th>ID</th><th>Motivo</th><th>Resolución</th></tr></thead><tbody>'+
   slice.map((it,index)=>{
    const globalIndex=F.issuePage*size+index;
    const kind=it.kind||'row';
    const key=it.key||window.ZPOTDualAppMerge.key('row',it.table,it.source,it.id);
    const saved=F.decisions[key];
    const canExclude=it.source==='new'&&it.id;
    const choice=it.kind==='collision'?
     '<option value="default">Sin decisión explícita (mantener ambos)</option>'+
     '<option value="keep-both">Conservar ambos, reasignar ID del ZIP B</option>'+
     '<option value="skip-new">Omitir registro del ZIP B</option>'+
     '<option value="keep-old">Conservar solo los valores de ZIP A (requiere identidad)</option>'+
     '<option value="replace-old">Actualizar desde ZIP B (requiere identidad)</option>':
     it.kind==='reference'?
     '<option value="default">Sin resolver</option><option value="link-parent">Asignar ID del padre existente</option>':
     '<option value="default">Sin resolver</option>'+(canExclude?'<option value="skip-row">Omitir fila del ZIP B</option>':'');
    const decision='<select class="fusion-choice" data-fusion-issue="'+globalIndex+'" data-fusion-key="'+safe(key)+'">'+
     choice.replace('value="'+safe(saved?.action||'default')+'"','value="'+safe(saved?.action||'default')+'" selected')+
     '</select>'+
     (it.kind==='reference'?'<input class="fusion-parent-id" data-fusion-issue="'+globalIndex+'" placeholder="ID padre en '+safe(it.targetTable||'')+'" value="'+safe(saved?.targetId||'')+'"/>':'')+
     '<button class="btn" data-fusion-apply="'+globalIndex+'">Aplicar</button>';
    return '<tr><td>'+(it.resolved?'✓ Resuelta':safe(it.severity))+'</td><td><code>'+safe(it.table)+'</code><small> · '+safe(it.source==='old'?'ZIP A':'ZIP B')+'</small></td>'+
     '<td>'+safe(it.id)+'</td><td>'+safe(it.message)+'</td><td><div class="fusion-actions">'+
     (it.resolved?'<span class="micro">Decisión aplicada · </span>':'')+decision+'</div></td></tr>';
   }).join('')+
   '</tbody></table></div>'+
   '<div class="actions"><button class="btn" id="fusion-issue-prev" '+(F.issuePage===0?'disabled':'')+'>Anterior</button>'+
    '<button class="btn" id="fusion-issue-next" '+(F.issuePage>=pages-1?'disabled':'')+'>Siguiente</button></div>'+
   '</div>';
 }
 function detailHtml(result){
  const name=F.detailTable||result.reports[0]?.name;
  const data=result.tables[name];
  if(!data)return '<div class="empty">No hay registros para previsualizar.</div>';
  const columns=data.columns.slice(0,12),rows=data.rows.slice(0,20);
  return '<div class="table-wrap"><table><thead><tr>'+columns.map(c=>'<th>'+safe(c)+'</th>').join('')+
   '</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(c=>'<td>'+safe(String(row[c]??'').slice(0,180))+'</td>').join('')+'</tr>').join('')+
   '</tbody></table></div><div class="footnote">Vista previa local: '+rows.length+' de '+fmt(data.rows.length)+' filas de '+safe(name)+
   '. Se muestran hasta 12 columnas; descarga el ZIP para revisar la tabla completa.</div>';
 }
 function tablesHtml(result){
  const items=result.reports.filter(r=>(!F.filter||r.name.toLowerCase().includes(F.filter.toLowerCase()))&&
   (!F.issuesOnly||result.issues.some(x=>x.table===r.name)));
  return '<div class="table-wrap"><table><thead><tr><th>Business Object</th><th>Regla</th><th>Antiguo</th><th>Nuevo</th><th>Final</th><th>Agregados</th><th>Unificados</th><th>IDs reasignados</th><th>Conflictos</th></tr></thead><tbody>'+
   items.map(r=>'<tr><td><strong>'+safe(r.name)+'</strong></td><td>'+safe(ruleLabel(r.policy))+'</td><td class="num">'+fmt(r.oldRows)+'</td><td class="num">'+fmt(r.newRows)+'</td><td class="num">'+fmt(r.resultRows)+'</td><td class="num">'+fmt(r.added)+'</td><td class="num">'+fmt(r.matched)+'</td><td class="num">'+fmt(r.collisions)+'</td><td class="num">'+fmt(r.conflicts)+'</td></tr>').join('')+
   '</tbody></table></div><div class="footnote">Mostrando '+items.length+' de '+result.reports.length+' BO. La auditoría descargable contiene todo el detalle.</div>';
 }
 async function readTables(ds){
  const tables={};
  const names=Object.keys(ds.tables||{}).sort();
  for(let i=0;i<names.length;i++){
   const name=names[i],raw=await rawCsv(ds,name);
   if(raw===null)continue;
   const rows=[];
   const visited=csvVisit(raw,(values,headers)=>{
    const record={};
    for(let k=0;k<headers.length;k++)record[headers[k]]=values[k]??'';
    rows.push(record);
   });
   if(new Set(visited.header).size!==visited.header.length)throw Error('Columnas repetidas en '+ds.filename+' / '+name);
   if(!visited.header.includes('id')&&rows.length)throw Error('Falta columna id en '+ds.filename+' / '+name);
   tables[name]={columns:visited.header,rows};
   if(i%8===0){status('Leyendo '+safe(ds.filename)+': '+(i+1)+'/'+names.length+' objetos');await new Promise(r=>setTimeout(r,0));}
  }
  return tables;
 }
 async function analyze(){
  if(F.busy)return;
  if(!valid())return status('Selecciona dos ZIP diferentes (antiguo y nuevo).',true);
  if(!window.ZPOTDualAppMerge)throw Error('Falta el motor de fusión. Ejecuta npm run build y recarga.');
  F.busy=true;F.preview=null;status('Iniciando análisis de los dos ZIP…');
  const sig=signature();
  try{
   const [older,newer]=await Promise.all([readTables(D[F.oldIndex]),readTables(D[F.newIndex])]);
   F.decisions={};F.issuePage=0;F.baselineConfirmed=false;
   const relationships=Object.fromEntries(Object.entries(window.ZPOTBOMasterModel?.objects||{}).map(([n,def])=>[n,def.outgoing||[]]));
   const keys=typeof PUB_UNIQUE_FIELDS==='object'?PUB_UNIQUE_FIELDS:{};
   F.inputs={oldTables:older,newTables:newer,relations:relationships,uniqueKeys:keys};
   recalculate();
   F.signature=sig;F.busy=false;
   renderPage();
  }catch(error){F.busy=false;status('No se pudo analizar: '+error.message,true);setMsg('Error en fusión: '+error.message,'error');}
  finally{F.busy=false;const b=document.getElementById('fusion-analyze');if(b)b.disabled=false;}
 }
 function recalculate(){
  if(!F.inputs||!window.ZPOTDualAppMerge||!window.ZPOTOracleMergeDelta)
   throw Error('No se ha cargado el motor de fusión/diferencias. Ejecuta npm run build.');
  const merged=window.ZPOTDualAppMerge.merge({...F.inputs,decisions:F.decisions});
  const delta=window.ZPOTOracleMergeDelta.build({baseline:F.inputs.oldTables,merged:merged.tables});
  F.preview=merged;F.delta=delta;
 }
 function applyDecision(key,action,targetId=''){
  if(!F.inputs)throw Error('Primero analiza ambos ZIP.');
  const previous=F.decisions[key],oldPreview=F.preview,oldDelta=F.delta;
  if(action==='default')delete F.decisions[key];
  else F.decisions[key]={action,...(targetId?{targetId}:{})};
  try{recalculate();}
  catch(error){
   if(previous)F.decisions[key]=previous;else delete F.decisions[key];
   F.preview=oldPreview;F.delta=oldDelta;throw error;
  }
  F.issuePage=0;renderPage();
 }
 function audit(){
  if(!F.preview||F.signature!==signature())throw Error('La vista previa cambió. Repite el análisis.');
  return {
   format:'BNCR-ZPOT-DUAL-APP-FUSION-v1',createdAt:new Date().toISOString(),
   sources:{old:{filename:D[F.oldIndex].filename,sha:D[F.oldIndex].sha},new:{filename:D[F.newIndex].filename,sha:D[F.newIndex].sha}},
   destination:F.destination==='oracle'?PUB_DEV_URL:'local/DataManager',
   policy:{catalogs:'older-first',cases:'opportunityNumber identity + newer verified modifications',configuration:'keyCatalog + newer timestamp',historical:'preserve both namespaces',idConflicts:'allocate new IDs and rewrite foreign keys'},
   totals:F.preview.totals,tables:F.preview.reports,issues:F.preview.issues,
   idMappings:F.preview.mappings,resolutions:F.preview.resolutions,decisions:F.decisions,
   baseline:{filename:D[F.oldIndex].filename,sha:D[F.oldIndex].sha,operatorConfirmed:F.baselineConfirmed},
   differential:{totals:F.delta?.totals,tables:F.delta?.report,operations:F.delta?.operations},
   publishAllowed:F.preview.totals.blocking===0&&F.baselineConfirmed
  };
 }
 function renderPage(){if(section==='fusionar')render();}
 async function zipBlob(mode='full'){
  const source=mode==='delta'?F.delta:F.preview;
  if(!source||F.signature!==signature())throw Error('Analiza los dos ZIP antes de exportar.');
  const zip=new JSZip(),names=Object.keys(source.tables).sort();
  for(let i=0;i<names.length;i++){
   const t=names[i],data=source.tables[t];
   zip.file(t+'.csv',makeCSV(data.columns,data.rows));
   if(i%12===0){status('Generando CSV '+(i+1)+'/'+names.length);await new Promise(r=>setTimeout(r,0));}
  }
  return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5},streamFiles:true},meta=>{
   status('Comprimiendo ZIP: '+Math.round(meta.percent)+'%');
  });
 }
 function fileName(mode='full'){
  const date=new Date().toISOString().replace(/[-:]/g,'').slice(0,15);
  const oldSha=String(D[F.oldIndex]?.sha||'').slice(0,6),newSha=String(D[F.newIndex]?.sha||'').slice(0,6);
  const stem=mode==='delta'?'BNCR_DIFERENCIAL_SOLO_CAMBIOS_':'BNCR_FUSION_COMPLETA_';
  return (F.preview?.totals.blocking?'BNCR_REVISAR_NO_PUBLICAR_':'')+stem+date+'_'+oldSha+'_'+newSha+'.zip';
 }
 async function exportZip(mode='full'){
  if(F.busy||!F.preview)return;
  F.busy=true;
  try{
   const blob=await zipBlob(mode);
   download(fileName(mode),blob);
   const total=mode==='delta'?F.delta.totals.totalWrites:F.preview.totals.result;
   status('ZIP '+(mode==='delta'?'diferencial':'consolidado')+' descargado ('+fmt(total)+
    ' filas). '+(F.preview.totals.blocking?'Es solo para revisión: existen conflictos.':'Guarda también la auditoría JSON.'));
  }catch(e){status(e.message,true);}
  finally{F.busy=false;}
 }
 async function preparePublication(){
  if(F.busy||!F.preview)return;
  if(F.destination!=='oracle')return status('Selecciona el destino Oracle.',true);
  if(!F.baselineConfirmed)return status('Confirma que el ZIP A representa los datos actuales de Oracle antes de continuar.',true);
  if(F.preview.totals.blocking)return status('Hay '+F.preview.totals.blocking+' incidencias bloqueantes. Resuélvelas antes de preparar la carga.',true);
  if(!F.delta?.totals.totalWrites)return status('No hay datos nuevos ni cambios para publicar.',true);
  if(!window.confirm('Preparar SOLO el ZIP diferencial para OIC Desarrollo. Los registros del ZIP A que no cambiaron NO serán enviados. No se escribirá nada todavía. El publicador solicitará GET y confirmación. ¿Continuar?'))return;
  F.busy=true;
  try{
   const blob=await zipBlob('delta');
   const file=new File([blob],fileName('delta'),{type:'application/zip'});
   await addFiles([file]);
   const source=D.findIndex(d=>d.filename===file.name);
   if(source<0)throw Error('No se registró el ZIP diferencial.');
   consolidation=new Set([source]);conSchema=source;active=source;schemaMode='reference';includeMode='all';
   PUB.tableSet=new Set(Object.keys(F.delta.tables));PUB.mode='sync';PUB.preserveIds=true;
   PUB.approved=false;PUB.testPassed=false;PUB.stageSession=null;
   F.busy=false;go('publicar');
   setMsg('Solo ZIP diferencial preparado: '+F.delta.totals.inserts+' inserciones y '+F.delta.totals.updates+
    ' actualizaciones; los datos sin cambios de ZIP A no se enviarán. Comprueba GET y autoriza cuando corresponda.','warn');
  }catch(e){status('No se pudo preparar la publicación: '+e.message,true);F.busy=false;}
 }
 document.addEventListener('change',e=>{
  const x=e.target;if(!x.closest('#main')||section!=='fusionar')return;
  if(x.id==='fusion-old'||x.id==='fusion-new'){
   F[x.id==='fusion-old'?'oldIndex':'newIndex']=Number(x.value);F.preview=null;F.delta=null;F.inputs=null;F.decisions={};F.baselineConfirmed=false;renderPage();
  }
  if(x.id==='fusion-destination'){F.destination=x.value;renderPage();}
  if(x.id==='fusion-detail-object'&&F.preview){F.detailTable=x.value;document.getElementById('fusion-detail-result').innerHTML=detailHtml(F.preview);}
  if(x.id==='fusion-only-issues'){F.issuesOnly=x.checked;document.getElementById('fusion-tables').innerHTML=tablesHtml(F.preview);}
 });
 document.addEventListener('input',e=>{
  const x=e.target;if(x.id==='fusion-filter'&&F.preview&&section==='fusionar'){
   F.filter=x.value;const target=document.getElementById('fusion-tables');if(target)target.innerHTML=tablesHtml(F.preview);
  }
 });
 document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||section!=='fusionar')return;
  if(b.id==='fusion-add')document.getElementById('zip-uploader')?.click();
  if(b.id==='fusion-analyze')analyze();
  if(b.id==='fusion-download')exportZip();
  if(b.id==='fusion-json'){try{downloadJSON('BNCR_FUSION_AUDITORIA_'+new Date().toISOString().slice(0,10)+'.json',audit());}catch(err){status(err.message,true);}}
  if(b.id==='fusion-publish')preparePublication();
 });
 window.ZPOTDualFusionUI={render:renderFusion,analyze,exportZip};
})();
