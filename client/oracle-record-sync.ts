/**
 * ID-first Oracle Business Object migration:
 * - GET existing source ID (or an explicitly restored mapped Oracle ID);
 * - PATCH an existing record;
 * - POST only when an unmapped source ID returns 404.
 * Any other GET error stops the migration. PATCH never creates a new BO.
 */
type ZpotSyncResponse={json:unknown;status:number;headers?:Headers};
type ZpotSyncResult={operation:'created'|'updated';targetId:string;result:ZpotSyncResponse};
type ZpotSyncTransport={
 read:(id:string)=>Promise<ZpotSyncResponse>;
 create:()=>Promise<ZpotSyncResponse>;
 update:(id:string)=>Promise<ZpotSyncResponse>;
};
async function syncOracleRecordById(
 sourceId:unknown,
 transport:ZpotSyncTransport,
 options:{mappedTargetId?:unknown;findUnique?:()=>Promise<{id:string;field:string}|null>;onTarget?:(targetId:string)=>void}={}
):Promise<ZpotSyncResult>{
 const valid=(value:unknown):string=>{
  const key=String(value??'').trim();
  if(!key||!/^[A-Za-z0-9._~-]+$/.test(key))throw Error('ID original o de Oracle inválido para publicación de Business Object.');
  return key;
 };
 const source=valid(sourceId);
 const mapped=options.mappedTargetId===undefined?undefined:valid(options.mappedTargetId);
 // A declared unique field may already exist under a different Oracle ID.
 // A strong exact match is preferred over a source-ID collision; it is not
 // a fuzzy name-based association.
 const unique=options.findUnique?await options.findUnique():null;
 const uniqueId=unique?valid(unique.id):undefined;
 if(mapped&&uniqueId&&mapped!==uniqueId)
  throw Error('Conflicto de identidad: el ID Oracle guardado ('+mapped+') difiere del encontrado por clave única ('+uniqueId+').');
 const target=uniqueId||mapped||source;
 options.onTarget?.(target);
 try{
  const response=await transport.read(target);
  const remoteId=(response.json as {id?:unknown}|null)?.id;
  if(remoteId!==undefined&&String(remoteId)!==target)
   throw Error('El registro consultado no coincide con el ID de Oracle solicitado: '+target);
 }catch(error){
  if((error as {status?:number})?.status!==404)throw error;
  if(mapped!==undefined||uniqueId!==undefined)
   throw Error('El ID Oracle '+target+' confirmado previamente ya no existe. No se creará otro registro automáticamente.');
  try{
   const result=await transport.create();
   return {operation:'created',targetId:source,result};
  }catch(createError){
   // A concurrent insertion can win between GET and POST. Reconcile a known
   // uniqueness violation once; never treat arbitrary HTTP 400 as duplicate.
   const err=createError as {status?:number;oracleType?:string};
   if(err.status!==400||!/uniquenessViolation/i.test(String(err.oracleType||''))||!options.findUnique)throw createError;
   const now=await options.findUnique();
   if(!now)throw createError;
   const resolved=valid(now.id);
   options.onTarget?.(resolved);
   await transport.read(resolved);
   const result=await transport.update(resolved);
   return {operation:'updated',targetId:resolved,result};
  }
 }
 const result=await transport.update(target);
 return {operation:'updated',targetId:target,result};
}
(globalThis as typeof globalThis & {ZPOTOracleRecordSync?:typeof syncOracleRecordById}).ZPOTOracleRecordSync=syncOracleRecordById;
