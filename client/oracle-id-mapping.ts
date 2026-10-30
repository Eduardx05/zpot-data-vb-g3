/**
 * Original IDs are authoritative. Oracle may still assign a different target ID
 * after POST, so we track the mapping and rewrite child foreign keys.
 * This registry is held only for the current migration session and is exported
 * in the audit report. Never attempt to match unrelated records by names.
 */
type ZpotBoRelation={field:string;target:string};
type ZpotMappedReference={field:string;parent:string;sourceId:string;oracleId:string};
function makeOracleIdRegistry(){
 const data=new Map<string,Map<string,string>>();
 const key=(value:unknown)=>String(value??'').trim();
 const put=(table:string,sourceId:unknown,targetId:unknown):void=>{
  const src=key(sourceId),target=key(targetId);
  if(!src||!target)throw Error('Se requieren ID de origen y de Oracle para registrar la relación '+table);
  let rows=data.get(table);
  if(!rows){rows=new Map();data.set(table,rows);}
  const previous=rows.get(src);
  if(previous!==undefined&&previous!==target)throw Error('Conflicto de ID para '+table+' origen '+src+': '+previous+' frente a '+target);
  rows.set(src,target);
 };
 const get=(table:string,sourceId:unknown):string|undefined=>data.get(table)?.get(key(sourceId));
 const rewrite=(row:Record<string,unknown>,outgoing:readonly ZpotBoRelation[])=>{
  const result={...row},replacements:ZpotMappedReference[]=[];
  for(const rel of outgoing){
   const field=rel?.field,parent=rel?.target;
   if(!field||!parent)continue;
   const value=row[field];
   if(value===null||value===undefined||String(value).trim()==='')continue;
   const target=get(parent,value);
   if(target===undefined||target===String(value))continue;
   // Preserve numeric type when Oracle source schema declares a numeric FK.
   if(typeof value==='number'){
    const numeric=Number(target);
    if(!Number.isSafeInteger(numeric))throw Error('El ID de Oracle para '+parent+' no es compatible con el FK numérico '+field);
    result[field]=numeric;
   }else{
    result[field]=target;
   }
   replacements.push({field,parent,sourceId:String(value),oracleId:target});
  }
  return {row:result,replacements};
 };
 const snapshot=()=>Object.fromEntries([...data].sort(([a],[b])=>a.localeCompare(b)).map(([table,items])=>[table,Object.fromEntries([...items].sort(([a],[b])=>a.localeCompare(b)))]));
 return {put,get,rewrite,snapshot};
}
/** Sort parent rows before children for self-referential relations within one BO. */
function sortRowsBySelfReferences<T extends Record<string,unknown>>(
 table:string,rows:readonly T[],outgoing:readonly ZpotBoRelation[]
):T[]{
 const selfFields=outgoing.filter(x=>x?.target===table&&x.field).map(x=>x.field);
 if(!selfFields.length)return [...rows];
 const records=new Map<string,T>();
 for(const row of rows){const id=String(row.id??'').trim();if(id)records.set(id,row);}
 const visited=new Set<string>(),visiting=new Set<string>(),ordered:T[]=[];
 const visit=(row:T):void=>{
  const id=String(row.id??'').trim();
  if(!id){ordered.push(row);return;}
  if(visited.has(id))return;
  if(visiting.has(id))throw Error('Dependencia circular entre registros de '+table+' (ID '+id+')');
  visiting.add(id);
  for(const field of selfFields){
   const ref=String(row[field]??'').trim(),parent=records.get(ref);
   if(ref&&parent&&ref!==id)visit(parent);
   if(ref===id)throw Error('Autorreferencia a sí mismo en '+table+' ID '+id);
  }
  visiting.delete(id);visited.add(id);ordered.push(row);
 };
 for(const row of rows)visit(row);
 return ordered;
}
(globalThis as typeof globalThis & {
 ZPOTOracleIdTools?:{createRegistry:typeof makeOracleIdRegistry;sortSelfRows:typeof sortRowsBySelfReferences}
}).ZPOTOracleIdTools={createRegistry:makeOracleIdRegistry,sortSelfRows:sortRowsBySelfReferences};
