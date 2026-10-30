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
 options:{mappedTargetId?:unknown}={}
):Promise<ZpotSyncResult>{
 const valid=(value:unknown):string=>{
  const key=String(value??'').trim();
  if(!key||!/^[A-Za-z0-9._~-]+$/.test(key))throw Error('ID original o de Oracle inválido para publicación de Business Object.');
  return key;
 };
 const source=valid(sourceId);
 const mapped=options.mappedTargetId===undefined?undefined:valid(options.mappedTargetId);
 const target=mapped||source;
 try{
  const response=await transport.read(target);
  const remoteId=(response.json as {id?:unknown}|null)?.id;
  if(remoteId!==undefined&&String(remoteId)!==target)
   throw Error('El registro consultado no coincide con el ID de Oracle solicitado: '+target);
 }catch(error){
  if((error as {status?:number})?.status!==404)throw error;
  if(mapped!==undefined)
   throw Error('El ID Oracle '+target+' previamente asociado al origen '+source+' ya no existe. No se creará otro registro automáticamente.');
  const result=await transport.create();
  return {operation:'created',targetId:source,result};
 }
 const result=await transport.update(target);
 return {operation:'updated',targetId:target,result};
}
(globalThis as typeof globalThis & {ZPOTOracleRecordSync?:typeof syncOracleRecordById}).ZPOTOracleRecordSync=syncOracleRecordById;
