/**
 * Conservative protection for Configuration when migrating Business Objects.
 * Environment-specific URLs and secrets MUST be reviewed and configured in
 * the destination, not copied unchanged from another Oracle environment.
 * Only IDs, key names and coarse reasons appear in audit summaries.
 */
type ZpotConfigurationRow=Record<string,unknown>;
type ZpotExcludedConfiguration={id:string;key:string;reason:string};
type ZpotConfigurationReview={safeRows:ZpotConfigurationRow[];excluded:ZpotExcludedConfiguration[]};
const SENSITIVE_CONFIGURATION_KEY=/URL|HOST|ENDPOINT|TOKEN|PASS(?:WORD)?|SECRET|CREDENTIAL|AUTH|OAUTH|API.?KEY|CLIENT.?ID|CLIENT.?SECRET|CERTIFICAT|PRIVATE.?KEY|SMTP|SFTP|CONNECTION|SERVER|WEBHOOK|REDIRECT|ORIGIN/i;
const SENSITIVE_CONFIGURATION_VALUE=/(?:https?:\/\/|www\.|\bbearer\s+[a-z0-9._~-]+|\b(?:jdbc|sftp|smtp|ftp):|(?:[a-z0-9-]+\.)+oraclecloud\.com|(?:[a-z0-9-]+\.)+(?:internal|local|corp|lan)\b)/i;
const CONFIG_KEY_COLUMNS=['keyCatalog','key','keyName','name','code','property','parameter'];
function reviewConfigurationRows(rows:readonly ZpotConfigurationRow[]):ZpotConfigurationReview{
 const safeRows:ZpotConfigurationRow[]=[];
 const excluded:ZpotExcludedConfiguration[]=[];
 for(const row of rows){
  const id=String(row.id??'').trim();
  const key=CONFIG_KEY_COLUMNS.map(col=>String(row[col]??'').trim()).find(Boolean)||'(sin clave)';
  let reason='';
  if(SENSITIVE_CONFIGURATION_KEY.test(key))reason='Clave de configuración del ambiente o de seguridad';
  else if(Object.entries(row).some(([column,value])=>{
   if(['id','creationDate','lastUpdateDate','createdBy','lastUpdatedBy','abcsChangeNumber'].includes(column))return false;
   if(typeof value!=='string')return false;
   return SENSITIVE_CONFIGURATION_VALUE.test(value);
  }))reason='Valor con URL o referencia a servidor';
  if(reason)excluded.push({id,key:key.slice(0,120),reason});
  else safeRows.push(row);
 }
 return {safeRows,excluded};
}
(globalThis as typeof globalThis & {ZPOTConfigurationReview?:typeof reviewConfigurationRows}).ZPOTConfigurationReview=reviewConfigurationRows;
