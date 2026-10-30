/**
 * Conservative Oracle Business Object upsert for a migration by original ID.
 * GET 2xx => PATCH, GET 404 => POST, all other GET failures => abort.
 * A missing ID is never treated as proof that a record does not exist.
 */
type ZpotSyncResult = {operation:'created'|'updated';result:{json:unknown;status:number}};
type ZpotSyncTransport = {
 read:(id:string)=>Promise<{json:unknown;status:number}>;
 create:()=>Promise<{json:unknown;status:number}>;
 update:(id:string)=>Promise<{json:unknown;status:number}>;
};
async function syncOracleRecordById(id:unknown,transport:ZpotSyncTransport):Promise<ZpotSyncResult>{
 const key=String(id??'').trim();
 if(!key||!/^[A-Za-z0-9._~-]+$/.test(key))throw Error('No se puede sincronizar el registro sin un ID original válido.');
 let exists=false;
 try{
  await transport.read(key);
  exists=true;
 }catch(error){
  // A 403, authentication error, timeout, or server failure is NOT "record missing".
  const status=(error as {status?:unknown})?.status;
  if(status!==404)throw error;
 }
 if(exists){
  const result=await transport.update(key);
  return {operation:'updated',result};
 }
 const result=await transport.create();
 return {operation:'created',result};
}
(globalThis as typeof globalThis & {ZPOTOracleRecordSync?:typeof syncOracleRecordById}).ZPOTOracleRecordSync=syncOracleRecordById;
