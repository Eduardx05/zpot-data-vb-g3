/**
 * Resolve a row's existing Oracle ID by metadata-declared unique fields.
 * This is a read-only operation and never assumes a matching name/substring.
 * Both q filtering and bounded fallback scans verify exact values locally.
 */
type ZpotUniqueDef={name:string;type:'string'|'number'};
type ZpotUniqueCollection={json:unknown;status:number};
type ZpotUniqueTransport={
 query:(expression:string)=>Promise<ZpotUniqueCollection>;
 page:(offset:number,limit:number)=>Promise<ZpotUniqueCollection>;
};
type ZpotUniqueResult={id:string;field:string}|null;
const ZPOT_UNIQUE_PAGE_SIZE=200;
const ZPOT_UNIQUE_MAX_SCAN=10000;
function uniqueMatch(row:Record<string,unknown>,field:ZpotUniqueDef,value:unknown):boolean {
 const candidate=row[field.name];
 if(candidate===null||candidate===undefined||value===null||value===undefined)return false;
 if(field.type==='number')return String(candidate).trim()!==''&&String(value).trim()!==''&&
  Number.isFinite(Number(candidate))&&Number(candidate)===Number(value);
 return typeof candidate==='string' && String(candidate)===String(value);
}
function collectionItems(reply:ZpotUniqueCollection):{items:Record<string,unknown>[];hasMore:boolean|undefined}{
 const json=reply?.json as {items?:unknown;hasMore?:unknown}|null;
 if(!json||!Array.isArray(json.items))throw Error('Respuesta de colección Oracle no contiene items; no se puede reconciliar por clave única.');
 if(!json.items.every(item=>item&&typeof item==='object'&&!Array.isArray(item)))throw Error('Respuesta de colección Oracle mal formada.');
 return {items:json.items as Record<string,unknown>[],hasMore:typeof json.hasMore==='boolean'?json.hasMore:undefined};
}
function matchingIds(items:Record<string,unknown>[],field:ZpotUniqueDef,value:unknown):string[]{
 const ids:string[]=[];
 for(const item of items){
  if(!uniqueMatch(item,field,value))continue;
  const id=String(item.id??'').trim();
  if(!id||!/^[A-Za-z0-9._~-]+$/.test(id))throw Error('La coincidencia única no contiene ID Oracle válido.');
  if(!ids.includes(id))ids.push(id);
 }
 if(ids.length>1)throw Error('Varias filas de Oracle coinciden con '+field.name+'; no se realizará PATCH automático.');
 return ids;
}
async function lookupUniqueOracleId(
 sourceRow:Record<string,unknown>,fields:ReadonlyArray<ZpotUniqueDef>,transport:ZpotUniqueTransport
):Promise<ZpotUniqueResult>{
 let matched:ZpotUniqueResult=null;
 for(const field of fields){
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field.name))throw Error('Campo de unicidad inválido.');
  const value=sourceRow[field.name];
  if(value===null||value===undefined||String(value).trim()==='')continue;
  const literal=field.type==='number'?
   (Number.isFinite(Number(value))?String(Number(value)):(()=>{throw Error('Valor de clave numérica inválido.');})()):
   "'"+String(value).replace(/'/g,"''")+"'";
  const query=field.name+' = '+literal;
  let matches:string[]|null=null;
  try{
   const response=collectionItems(await transport.query(query));
   // If the Oracle framework ignores q, do NOT assume "not found" from
   // the first unfiltered page: scan the bounded collection instead.
   if(response.items.some(item=>!uniqueMatch(item,field,value)))matches=null;
   else if(response.hasMore&&response.items.length===0)matches=null;
   else matches=matchingIds(response.items,field,value);
  }catch(error){
   const status=(error as {status?:number})?.status;
   if(status!==400&&status!==422)throw error;
  }
  if(matches===null){
   const found=new Set<string>();
   let complete=false;
   for(let offset=0;offset<ZPOT_UNIQUE_MAX_SCAN;offset+=ZPOT_UNIQUE_PAGE_SIZE){
    const result=collectionItems(await transport.page(offset,ZPOT_UNIQUE_PAGE_SIZE));
    for(const id of matchingIds(result.items,field,value))found.add(id);
    if(found.size>1)throw Error('Múltiples registros con el mismo valor único '+field.name);
    if(result.hasMore===false || (result.hasMore===undefined&&result.items.length<ZPOT_UNIQUE_PAGE_SIZE)){
     complete=true;break;
    }
    if(result.items.length===0)throw Error('Oracle indicó más resultados pero no devolvió filas.');
   }
   if(!complete)throw Error('No se ha revisado la colección completa (más de 10000 registros). Se detiene para prevenir duplicados.');
   matches=[...found];
  }
  if(matches.length>1)throw Error('Coincidencia ambigua de clave única '+field.name);
  if(matches.length===1){
   const id=matches[0];
   if(matched&&matched.id!==id)throw Error('Los campos únicos apuntan a distintos IDs de Oracle.');
   matched={id,field:field.name};
  }
 }
 return matched;
}
(globalThis as typeof globalThis & {
 ZPOTUniqueLookup?:{find:typeof lookupUniqueOracleId}
}).ZPOTUniqueLookup={find:lookupUniqueOracleId};
