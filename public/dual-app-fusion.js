/* ZPOT | Fusión de dos aplicaciones Oracle. Independent of the v1 publisher.
   Runs locally against ZIPs already loaded by the explorer. */
(function(){
 'use strict';
 const F={oldIndex:-1,newIndex:-1,preview:null,signature:'',busy:false,destination:'zip',filter:'',issuesOnly:false};
 const safe=(value)=>esc(String(value??''));
 const name=(index)=>D[index]?nominal(D[index]):'No seleccionado';
 const choices=(current,exclude)=>'<option value="-1">Selecciona un ZIP…</option>'+
   D.map((d,i)=>({d,i})).filter(x=>!x.d.isDemo&&x.i!==exclude).map(({d,i})=>
    '<option value="'+i+'" '+(current===i?'selected':'')+'>'+safe(d.filename)+' · '+fmt(stats(d).totalRows)+' filas</option>').join('');
 const signature=()=>JSON.stringify([D[F.oldIndex]?.sha,D[F.newIndex]?.sha]);
 const valid=()=>Number.isInteger(F.oldIndex)&&Number.isInteger(F.newIndex)&&F.oldIndex>=0&&F.newIndex>=0&&
  F.oldIndex!==F.newIndex&&D[F.oldIndex]&&!D[F.oldIndex].isDemo&&D[F.newIndex]&&!D[F.newIndex].isDemo;
 function ruleLabel(policy){return {
  'catalog-old':'Catálogos: conservar antiguos + incorporar nuevos',
  cases:'Cases: conservar históricos + agregar cambios por opportunityNumber',
  configuration:'Configuration: aplicar valores con fecha posterior verificable',
  operations:'Operación e historiales: preservar ambas versiones'
 }[policy]||policy;}
 function status(message,error){
  const el=document.getElementById('fusion-status');
  if(el){el.textContent=message;el.className='notice'+(error?' danger':'');}
 }
 function render(){
  const good=valid(),result=F.preview&&F.signature===signature()?F.preview:null;
  const note='<div class="notice"><strong>Flujo independiente.</strong> Esta página no cambia la publicación existente. Los dos ZIP se leen localmente; se crea un tercer ZIP y su auditoría sin modificar los originales ni escribir en Oracle. Los conflictos de identidad y las referencias sin resolver bloquean el envío directo.</div>';
  let html=pagehead('Fusionar dos aplicaciones Oracle','Consolida catálogos de la versión antigua con Cases y cambios recientes de la versión nueva. Conserva las relaciones por ID y permite elegir dónde depositar el resultado.')+note;
  html+=block('1 · Elegir las dos aplicaciones',`
   <div class="settings-grid">
    <label>ZIP de la aplicación antigua (base de catálogos)<select id="fusion-old">${choices(F.oldIndex,F.newIndex)}</select></label>
    <label>ZIP de la aplicación nueva (Cases y configuraciones)<select id="fusion-new">${choices(F.newIndex,F.oldIndex)}</select></label>
   </div>
   <div class="actions"><button class="btn" id="fusion-add">＋ Cargar uno o dos ZIP adicionales</button></div>
   <p class="micro">La asignación «antigua/nueva» la determina tu selección, no el nombre del archivo. No se aceptan fuentes DEMO. Los ZIP deben contener archivos CSV de los BO.</p>`);
  html+=block('2 · Reglas de fusión',`
   <div class="fusion-rules">
    <div><strong>Catálogos</strong><small>Preservar los valores históricos. Nuevos registros se incorporan sin sobrescribir IDs.</small></div>
    <div><strong>Cases</strong><small>Unir por opportunityNumber cuando esté disponible y no sea ambiguo. Si el mismo ID identifica casos distintos, generar ID nuevo y reasociar hijos.</small></div>
    <div><strong>Configuration</strong><small>Combinar por keyCatalog/key. Preferir un valor nuevo solo cuando su lastUpdateDate sea posterior.</small></div>
    <div><strong>Historiales y etapas</strong><small>Preservar filas de ambos orígenes; nunca deduplicar por coincidencia de ID solamente.</small></div>
   </div>
   <div class="actions"><button class="btn btn-primary" id="fusion-analyze" ${!good||F.busy?'disabled':''}>Analizar y generar vista previa</button></div>
   <div id="fusion-status" class="notice">${F.busy?'Analizando tablas de los dos ZIP…':result?'Análisis completado. Revisa los conflictos y selecciona el destino.':'Selecciona ambos ZIP para comenzar.'}</div>`);
  if(result){
   const m=result.totals;
   html+=block('3 · Resultado previo',`
    <div class="metrics">
     <div class="metric"><div class="metric-label">Filas en ZIP antiguo</div><div class="metric-number">${fmt(m.old)}</div></div>
     <div class="metric"><div class="metric-label">Filas en ZIP nuevo</div><div class="metric-number">${fmt(m.new)}</div></div>
     <div class="metric"><div class="metric-label">Filas consolidadas</div><div class="metric-number">${fmt(m.result)}</div></div>
     <div class="metric"><div class="metric-label">Incidencias bloqueantes</div><div class="metric-number">${fmt(m.blocking)}</div></div>
    </div>
    <div class="chips">${badge(fmt(m.added)+' nuevas','teal')} ${badge(fmt(m.matched)+' conciliadas','ok')} ${badge(fmt(m.collisions)+' IDs reasignados','amber')} ${badge(fmt(m.missingReferences)+' referencias sin resolver',m.missingReferences?'danger':'ok')}</div>
    ${m.blocking?'<div class="notice danger"><strong>Existen incidencias que requieren revisión.</strong> Se permite exportar un ZIP de diagnóstico, pero no prepararlo para publicación hasta resolver las referencias y los conflictos.</div>':'<div class="notice success"><strong>Prevalidación sin errores bloqueantes.</strong> Revisa igualmente las reglas de identidad y el esquema del destino antes de publicar.</div>'}
    <div class="search-line"><input id="fusion-filter" placeholder="Filtrar BO por nombre" value="${safe(F.filter)}"/><label class="check-inline"><input id="fusion-only-issues" type="checkbox" ${F.issuesOnly?'checked':''}/> Solo con incidencias</label></div>
    <div id="fusion-tables">${tablesHtml(result)}</div>
    ${result.issues.length?'<details><summary>Ver primeras incidencias ('+fmt(result.issues.length)+')</summary><div class="table-wrap"><table><thead><tr><th>Severidad</th><th>BO</th><th>Origen</th><th>ID</th><th>Motivo</th></tr></thead><tbody>'+
     result.issues.slice(0,120).map(i=>'<tr><td>'+safe(i.severity)+'</td><td><code>'+safe(i.table)+'</code></td><td>'+safe(i.source)+'</td><td>'+safe(i.id)+'</td><td>'+safe(i.message)+'</td></tr>').join('')+
     '</tbody></table></div></details>':''}`);
   html+=block('4 · Elegir destino y preparar entrega',`
     <label class="block-label">¿Dónde depositar el consolidado?
      <select id="fusion-destination">
       <option value="zip" ${F.destination==='zip'?'selected':''}>Descargar ZIP + auditoría JSON para revisión y Data Manager</option>
       <option value="oracle" ${F.destination==='oracle'?'selected':''}>Preparar envío a OIC Desarrollo mediante el publicador actual</option>
      </select>
     </label>
     <div class="notice">${F.destination==='oracle'?'<strong>Destino permitido:</strong> OIC Desarrollo, aplicación BNCR_CREDIT_APPROVAL_2026_GEN3_V2 (Live de desarrollo). La página de fusión no enviará datos directamente: abrirá el publicador existente, con GET de prueba y confirmación de escritura.':'<strong>Exportación local:</strong> un ZIP con CSV por Business Object y un JSON con equivalencias por origen, conflictos, reglas y conteos. Su importación mediante Data Manager debe evaluarse cuidadosamente; no sustituye la publicación diferencial por PATCH.'}</div>
     <div class="actions">
      <button class="btn btn-primary" id="fusion-download" ${F.busy?'disabled':''}>Descargar ZIP consolidado${m.blocking?' (diagnóstico)':''}</button>
      <button class="btn" id="fusion-json" ${F.busy?'disabled':''}>Descargar auditoría JSON</button>
      ${F.destination==='oracle'?'<button class="btn btn-primary" id="fusion-publish" '+(m.blocking||F.busy?'disabled':'')+'>Preparar publicación en Oracle</button>':''}
     </div>
     <p class="footnote">La publicación es una operación separada. El ZIP generado no borra datos y no implica que los conflictos de unicidad del destino estén resueltos; el publicador debe validarlos contra Oracle.</p>`);
  }
  return html;
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
   const relationships=Object.fromEntries(Object.entries(window.ZPOTBOMasterModel?.objects||{}).map(([n,def])=>[n,def.outgoing||[]]));
   const keys=typeof PUB_UNIQUE_FIELDS==='object'?PUB_UNIQUE_FIELDS:{};
   const merged=window.ZPOTDualAppMerge.merge({oldTables:older,newTables:newer,relations:relationships,uniqueKeys:keys});
   F.preview=merged;F.signature=sig;
   renderPage();
  }catch(error){status('No se pudo analizar: '+error.message,true);setMsg('Error en fusión: '+error.message,'error');}
  finally{F.busy=false;const b=document.getElementById('fusion-analyze');if(b)b.disabled=false;}
 }
 function audit(){
  if(!F.preview||F.signature!==signature())throw Error('La vista previa cambió. Repite el análisis.');
  return {
   format:'BNCR-ZPOT-DUAL-APP-FUSION-v1',createdAt:new Date().toISOString(),
   sources:{old:{filename:D[F.oldIndex].filename,sha:D[F.oldIndex].sha},new:{filename:D[F.newIndex].filename,sha:D[F.newIndex].sha}},
   destination:F.destination==='oracle'?PUB_DEV_URL:'local/DataManager',
   policy:{catalogs:'older-first',cases:'opportunityNumber identity + newer verified modifications',configuration:'keyCatalog + newer timestamp',historical:'preserve both namespaces',idConflicts:'allocate new IDs and rewrite foreign keys'},
   totals:F.preview.totals,tables:F.preview.reports,issues:F.preview.issues,
   idMappings:F.preview.mappings,
   publishAllowed:F.preview.totals.blocking===0
  };
 }
 function renderPage(){if(section==='fusionar')render();}
 async function zipBlob(){
  const merged=F.preview;if(!merged||F.signature!==signature())throw Error('Analiza los dos ZIP antes de exportar.');
  const zip=new JSZip(),names=Object.keys(merged.tables).sort();
  for(let i=0;i<names.length;i++){
   const t=names[i],data=merged.tables[t];
   zip.file(t+'.csv',makeCSV(data.columns,data.rows));
   if(i%12===0){status('Generando CSV '+(i+1)+'/'+names.length);await new Promise(r=>setTimeout(r,0));}
  }
  return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5},streamFiles:true},meta=>{
   status('Comprimiendo ZIP: '+Math.round(meta.percent)+'%');
  });
 }
 function fileName(){
  const date=new Date().toISOString().slice(0,10);
  return (F.preview?.totals.blocking?'BNCR_FUSION_REVISAR_NO_PUBLICAR_':'BNCR_FUSION_CONSOLIDADA_')+date+'.zip';
 }
 async function exportZip(){
  if(F.busy||!F.preview)return;
  F.busy=true;
  try{
   const blob=await zipBlob();
   download(fileName(),blob);
   status('ZIP descargado ('+fmt(F.preview.totals.result)+' filas). '+(F.preview.totals.blocking?'Es solo para revisión: existen bloqueos.':'Descarga también la auditoría JSON.'));
  }catch(e){status(e.message,true);}
  finally{F.busy=false;}
 }
 async function preparePublication(){
  if(F.busy||!F.preview)return;
  if(F.destination!=='oracle')return status('Selecciona el destino Oracle.',true);
  if(F.preview.totals.blocking)throw Error('Hay '+F.preview.totals.blocking+' incidencias bloqueantes. Descarga la auditoría; no se preparará una carga potencialmente inconsistente.');
  if(!window.confirm('Se preparará el ZIP fusionado en el publicador actual, SOLO para OIC Desarrollo. No se enviará ningún registro todavía. Deberás verificar GET, revisar el mapa y autorizar la publicación explícitamente. ¿Continuar?'))return;
  F.busy=true;
  try{
   const blob=await zipBlob();
   const file=new File([blob],fileName(),{type:'application/zip'});
   await addFiles([file]);
   const source=D.findIndex(d=>d.filename===file.name);
   if(source<0)throw Error('No se registró el ZIP consolidado.');
   consolidation=new Set([source]);conSchema=source;active=source;schemaMode='reference';includeMode='all';
   PUB.tableSet=new Set(Object.keys(F.preview.tables));PUB.mode='sync';PUB.preserveIds=true;
   PUB.approved=false;PUB.testPassed=false;PUB.stageSession=null;
   F.busy=false;go('publicar');
   setMsg('ZIP fusionado preparado. Comprueba el destino con GET y revisa todos los registros antes de habilitar la escritura.','warn');
  }catch(e){status('No se pudo preparar el publicador: '+e.message,true);F.busy=false;}
 }
 document.addEventListener('change',e=>{
  const x=e.target;if(!x.closest('#main')||section!=='fusionar')return;
  if(x.id==='fusion-old'||x.id==='fusion-new'){
   F[x.id==='fusion-old'?'oldIndex':'newIndex']=Number(x.value);F.preview=null;renderPage();
  }
  if(x.id==='fusion-destination'){F.destination=x.value;renderPage();}
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
 window.ZPOTDualFusionUI={render,analyze,exportZip};
})();
