/**
 * ZPOT | Dual-application merge preview
 * Pure, local, and side-effect-free. Never writes to Oracle.
 * Each source has its own ID namespace. Catalogs prefer the older app;
 * Cases use verified opportunityNumber identity; Configuration uses keyCatalog
 * and strict lastUpdateDate preference; unrelated operational IDs are never
 * assumed to refer to the same record.
 */
type FusionRow=Record<string,string>;
type FusionTable={columns:string[];rows:FusionRow[]};
type FusionRelation={field:string;target:string};
type FusionField={name:string;type?:string};
type FusionAction='keep-both'|'skip-new'|'keep-old'|'replace-old'|'skip-row'|'link-parent';
type FusionDecision={action:FusionAction;targetId?:string};
type FusionDecisions=Record<string,FusionDecision>;
function fusionDecisionKey(kind:string,table:string,source:'old'|'new',id:string,field=''):string{
 return [kind,table,source,id,field].map(encodeURIComponent).join('|');
}
type FusionInput={decisions?:FusionDecisions;
 oldTables:Record<string,FusionTable>;newTables:Record<string,FusionTable>;
 relations?:Record<string,readonly FusionRelation[]>;
 uniqueKeys?:Record<string,readonly FusionField[]>;
};
type FusionIssue={severity:'blocking'|'warning';table:string;source:'old'|'new';id:string;message:string;
 kind?:string;key?:string;field?:string;targetTable?:string;referenceId?:string;resolved?:boolean;};
type FusionTableReport={
 name:string;policy:string;oldRows:number;newRows:number;resultRows:number;
 added:number;matched:number;collisions:number;updated:number;unchanged:number;conflicts:number;skipped:number;
};
type FusionResult={
 tables:Record<string,FusionTable>;
 mappings:{old:Record<string,Record<string,string>>;new:Record<string,Record<string,string>>};
 issues:FusionIssue[]; reports:FusionTableReport[];resolutions:Array<{key:string;action:FusionAction;table:string;source:string;id:string;targetId?:string}>;
 totals:{old:number;new:number;result:number;added:number;matched:number;collisions:number;blocking:number;warnings:number;missingReferences:number};
};
function fuseBusinessObjectZips(input:FusionInput):FusionResult{
 const oldTables=input.oldTables||{},newTables=input.newTables||{},decisions=input.decisions||{};
 const issueList:FusionIssue[]=[],resolutions:FusionResult['resolutions']=[];
 const issue=(severity:FusionIssue['severity'],table:string,source:FusionIssue['source'],id:string,message:string,
  meta:Partial<FusionIssue>={}):void=>{
  if(issueList.length<15000)issueList.push({severity,table,source,id,message,...meta});
 };
 const rule=(kind:string,table:string,source:'old'|'new',id:string,field='')=>
  decisions[fusionDecisionKey(kind,table,source,id,field)];
 const recordDecision=(kind:string,table:string,source:'old'|'new',id:string,choice:FusionDecision,field='')=>{
  resolutions.push({key:fusionDecisionKey(kind,table,source,id,field),action:choice.action,table,source,id,
   ...(choice.targetId?{targetId:choice.targetId}:{})});
 };
 const skipRow=(table:string,source:'old'|'new',id:string):boolean=>{
  const choice=rule('row',table,source,id);
  if(!choice)return false;
  if(choice.action!=='skip-row'){
   issue('blocking',table,source,id,'Acción de exclusión de fila no válida.');return false;
  }
  recordDecision('row',table,source,id,choice);return true;
 };
 const mappings:FusionResult['mappings']={old:{},new:{}};
 const result:Record<string,FusionTable>={},reports:FusionTableReport[]=[];
 const allNames=[...new Set([...Object.keys(oldTables),...Object.keys(newTables)])].sort();
 type Item={row:FusionRow;origin:'old'|'new';fieldOrigins:Record<string,'old'|'new'>};
 const itemsByTable=new Map<string,Item[]>();
 const clean=(v:unknown)=>String(v??'').trim();
 const normalize=(v:unknown)=>clean(v).normalize('NFC').toLocaleLowerCase('es').replace(/\s+/g,' ');
 const validId=(v:unknown)=>/^[A-Za-z0-9._~-]+$/.test(clean(v));
 const identityField=(table:string,columns:string[]):string|undefined=>{
  // These are declared unique:true in the exported entity model. Other
  // columns are NOT assumed to be globally unique across app versions.
  if(table==='Cases')return ['opportunityNumber','OPPORTUNITYNUMBER'].find(x=>columns.includes(x));
  if(table==='Configuration')return ['keyCatalog','key'].find(x=>columns.includes(x));
  return (input.uniqueKeys?.[table]||[]).map(x=>x.name).find(x=>columns.includes(x)&&
    // Numeric FK IDs are scoped to each app, not shared business identities.
    !(input.relations?.[table]||[]).some(rel=>rel.field===x));
 };
 const equivalent=(a:FusionRow,b:FusionRow,columns:string[])=>columns.every(k=>
  ['creationDate','lastUpdateDate','createdBy','lastUpdatedBy','abcsChangeNumber'].includes(k)||clean(a[k])===clean(b[k]));
 const timestamp=(row:FusionRow):number=>{
  const date=Date.parse(clean(row.lastUpdateDate)||clean(row.creationDate));
  return Number.isFinite(date)?date:0;
 };
 for(const table of allNames){
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(table)){issue('blocking',table,'old','', 'Nombre de Business Object inválido.');continue;}
  const older=oldTables[table]||{columns:[],rows:[]},newer=newTables[table]||{columns:[],rows:[]};
  const columns=[...new Set([...older.columns,...newer.columns])];
  const type=table==='Cases'?'cases':table==='Configuration'?'configuration':
    table==='CaseStage'||/history|observation|correction|detail|^visits$|^users$|^zones$/i.test(table)?'operations':
    'catalog-old';
  const stat:FusionTableReport={name:table,policy:type,oldRows:older.rows.length,newRows:newer.rows.length,resultRows:0,
   added:0,matched:0,collisions:0,updated:0,unchanged:0,conflicts:0,skipped:0};
  const byId=new Map<string,Item>(),items:Item[]=[];
  const byBusiness=new Map<string,Item|false>();
  const businessField=identityField(table,columns);
  const businessKey=(r:FusionRow)=>businessField&&clean(r[businessField])?normalize(r[businessField]):'';
  const used=new Set<string>();
  let maxId=0n;
  for(const r of [...older.rows,...newer.rows]){
   const id=clean(r.id);if(/^\d+$/.test(id)){const n=BigInt(id);if(n>maxId)maxId=n;}
  }
  const allocated=():string=>{
   let next:string;do{maxId++;next=maxId.toString();}while(used.has(next));
   used.add(next);return next;
  };
  const remember=(source:'old'|'new',originalId:string,targetId:string)=>{
   const map=(mappings[source][table]??={});
   if(map[originalId]&&map[originalId]!==targetId){
    issue('blocking',table,source,originalId,'Un ID de origen aparece asociado con dos registros distintos.');
   }else map[originalId]=targetId;
  };
  const registerBusiness=(item:Item)=>{
   const key=businessKey(item.row);
   if(!key)return;
   if(!byBusiness.has(key))byBusiness.set(key,item);
   else if(byBusiness.get(key)!==item){byBusiness.set(key,false);stat.conflicts++;
    issue('blocking',table,item.origin,clean(item.row.id),
     'Clave de negocio duplicada en los datos consolidados: '+businessField+'. Requiere revisión.');}
  };
  const put=(row:FusionRow,origin:'old'|'new',oldId:string,newId:string):Item=>{
   const copy={...row,id:newId};
   const item:Item={row:copy,origin,fieldOrigins:Object.fromEntries(columns.map(c=>[c,origin]))};
   items.push(item);byId.set(newId,item);used.add(newId);remember(origin,oldId,newId);
   registerBusiness(item);
   return item;
  };
  for(const row of older.rows){
   const id=clean(row.id);
   if(validId(id)&&skipRow(table,'old',id)){stat.skipped++;continue;}
   if(!validId(id)){issue('blocking',table,'old',id,'Fila antigua sin ID válido; no se puede preservar.');continue;}
   if(byId.has(id)){issue('blocking',table,'old',id,'ID duplicado dentro del ZIP antiguo.');continue;}
   put(row,'old',id,id);
  }
  for(const row of newer.rows){
   const sourceId=clean(row.id);
   if(validId(sourceId)&&skipRow(table,'new',sourceId)){stat.skipped++;continue;}
   if(!validId(sourceId)){issue('blocking',table,'new',sourceId,'Fila nueva sin ID válido; no se puede asignar referencia.');continue;}
   const key=businessKey(row);
   let match:Item|undefined;
   if(key){
    const candidate=byBusiness.get(key);
    if(candidate===false){issue('blocking',table,'new',sourceId,
      'Clave de negocio ambigua '+businessField+'; se conserva como conflicto sin fusionar.');stat.conflicts++;}
    else if(candidate)match=candidate;
   }
   const bySameId=byId.get(sourceId);
   const collisionRule=bySameId?rule('collision',table,'new',sourceId):undefined;
   if(collisionRule?.action==='skip-new'){
    stat.skipped++;recordDecision('collision',table,'new',sourceId,collisionRule);continue;
   }
   if(!match&&bySameId&&collisionRule&&['keep-old','replace-old'].includes(collisionRule.action)){
    const fk=input.relations?.[table]||[];
    const a=businessKey(row),b=businessKey(bySameId.row);
    if(fk.length||(table==='Cases'&&(!a||!b||a!==b))||(a&&b&&a!==b)){
      issue('blocking',table,'new',sourceId,'No se pueden unificar IDs: claves de negocio o referencias incompatibles.',
       {kind:'collision',key:fusionDecisionKey('collision',table,'new',sourceId)});
    }else{
      match=bySameId;recordDecision('collision',table,'new',sourceId,collisionRule);
    }
   }
   if(!match&&bySameId&&!(input.relations?.[table]||[]).length&&equivalent(row,bySameId.row,columns))
    match=bySameId;
   if(match){
    const target=match.row.id;
    remember('new',sourceId,target);stat.matched++;
    // When the same source ID collides with a different record, business
    // identity is authoritative. Do not overwrite the unrelated record.
    const isCatalog=type==='catalog-old',isConfig=type==='configuration';
    const forceOld=collisionRule?.action==='keep-old'&&match===bySameId;
    const forceNew=collisionRule?.action==='replace-old'&&match===bySameId;
    const newIsNewer=timestamp(row)>timestamp(match.row);
    let changes=0;
    for(const c of columns){
     if(c==='id'||['creationDate','createdBy','abcsChangeNumber'].includes(c))continue;
     const value=row[c];if(value===undefined||value==='')continue;
     const was=match.row[c]??'';
     let update=false;
     if(forceOld)update=false;
     else if(forceNew)update=was!==value;
     else if(isCatalog)update=was==='';
     else if(isConfig)update=was===''||(newIsNewer&&was!==value);
     else update=was===''||(!isConfig&&!isCatalog&&newIsNewer&&was!==value);
     if(update&&was!==value){match.row[c]=value;match.fieldOrigins[c]='new';changes++;}
     else if(was!==value&&!update&&isConfig&&!newIsNewer)
      issue('warning',table,'new',sourceId,'Configuración '+c+' diferente, sin fecha nueva verificable: se conserva el valor anterior.');
    }
    if(changes)stat.updated++;else stat.unchanged++;
    continue;
   }
   // Different business identity and overlapping PK: never overwrite.
   const collides=used.has(sourceId);
   const target=collides?allocated():sourceId;
   if(collides){
    stat.collisions++;
    const key=fusionDecisionKey('collision',table,'new',sourceId);
    if(collisionRule?.action==='keep-both'){
     recordDecision('collision',table,'new',sourceId,collisionRule);
     issue('warning',table,'new',sourceId,'Reasignación aprobada: '+sourceId+' → '+target+' (se conservan ambos).',
      {kind:'collision',key,resolved:true});
    }else{
     issue('warning',table,'new',sourceId,'ID repetido entre aplicaciones sin identidad de negocio verificada; se reasignó a '+target+'.',
      {kind:'collision',key});
    }
   }
   put(row,'new',sourceId,target);stat.added++;
  }
  stat.resultRows=items.length;
  result[table]={columns,rows:items.map(item=>item.row)};
  itemsByTable.set(table,items);reports.push(stat);
 }
 let missing=0;
 for(const [table,items] of itemsByTable){
  const rels=input.relations?.[table]||[];
  for(const item of items)for(const rel of rels){
   if(!rel?.field||!rel?.target)continue;
   const original=clean(item.row[rel.field]);if(!original||original==='0')continue;
   // Some Visual Builder relationship descriptors refer to textual fields.
   // Rewrite only ID-like values; leave text unmodified but report it.
   if(['approvalTypeName','legalDocumentName','macroProcessName'].includes(rel.field)){
    // The original model has name-based (not numeric FK ID) references here.
    // They must remain strings. Name changes are not inferred as IDs.
    continue;
   }
   if(!validId(original)){issue('warning',table,item.origin,clean(item.row.id),
     'Referencia de texto '+rel.field+' sin resolución automática.');continue;}
   const origin=item.fieldOrigins[rel.field]||item.origin;
   const refRule=rule('reference',table,origin,clean(item.row.id),rel.field);
   if(refRule?.action==='link-parent'){
    const target=clean(refRule.targetId);
    if(result[rel.target]?.rows.some(row=>clean(row.id)===target)){
     item.row[rel.field]=target;recordDecision('reference',table,origin,clean(item.row.id),refRule,rel.field);
     continue;
    }
    missing++;
    issue('blocking',table,origin,clean(item.row.id),
     'El ID '+target+' seleccionado no existe en el BO padre '+rel.target+'.',
     {kind:'reference',key:fusionDecisionKey('reference',table,origin,clean(item.row.id),rel.field),
      field:rel.field,targetTable:rel.target,referenceId:original});continue;
   }
   const preferred=mappings[origin][rel.target]?.[original];
   const other=mappings[origin==='old'?'new':'old'][rel.target]?.[original];
   const mapped=preferred||(preferred===undefined?other:undefined);
   if(!mapped){missing++;issue('blocking',table,origin,clean(item.row.id),
      'Referencia no resuelta: '+table+'.'+rel.field+'='+original+' → '+rel.target,
      {kind:'reference',key:fusionDecisionKey('reference',table,origin,clean(item.row.id),rel.field),
       field:rel.field,targetTable:rel.target,referenceId:original});continue;}
   // When origin data references a parent that exists in both sources with
   // different new IDs, mapping through the other source needs review.
   if(!preferred&&other)issue('warning',table,origin,clean(item.row.id),
    'Referencia '+rel.field+' resuelta desde el otro ZIP; verificar que comparten identidad de negocio.');
   item.row[rel.field]=mapped;
  }
 }
 const totals={old:reports.reduce((n,r)=>n+r.oldRows,0),new:reports.reduce((n,r)=>n+r.newRows,0),
 result:reports.reduce((n,r)=>n+r.resultRows,0),added:reports.reduce((n,r)=>n+r.added,0),
 matched:reports.reduce((n,r)=>n+r.matched,0),collisions:reports.reduce((n,r)=>n+r.collisions,0),
 blocking:issueList.filter(x=>x.severity==='blocking'&&!x.resolved).length,
 warnings:issueList.filter(x=>x.severity==='warning'&&!x.resolved).length,
 missingReferences:missing};
 return {tables:result,mappings,issues:issueList,reports,resolutions,totals};
}
(globalThis as typeof globalThis & {ZPOTDualAppMerge?:{merge:typeof fuseBusinessObjectZips;key:typeof fusionDecisionKey}}).ZPOTDualAppMerge={merge:fuseBusinessObjectZips,key:fusionDecisionKey};
