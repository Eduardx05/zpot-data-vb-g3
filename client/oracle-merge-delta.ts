/**
 * Build a minimal Oracle write set from a protected target snapshot and a
 * reviewed two-ZIP consolidation. No Oracle API is called here.
 *
 * The target snapshot is the ZIP explicitly marked by the user as already
 * present in Oracle. Its IDs are retained. The output contains ONLY inserts
 * and changed fields to PATCH; unchanged rows are never republished.
 */
type ZpotDeltaRow=Record<string,string>;
type ZpotDeltaTable={columns:string[];rows:ZpotDeltaRow[]};
type ZpotDeltaInput={
 baseline:Record<string,ZpotDeltaTable>;
 merged:Record<string,ZpotDeltaTable>;
};
type ZpotDeltaOperation={
 object:string;id:string;action:'create'|'update';
 changedFields:string[];beforeId?:string;
};
type ZpotDeltaReport={
 tables:Record<string,ZpotDeltaTable>;
 operations:ZpotDeltaOperation[];
 report:Array<{object:string;baseline:number;consolidated:number;unchanged:number;updates:number;inserts:number}>;
 totals:{existing:number;unchanged:number;updates:number;inserts:number;totalWrites:number};
};
function buildOracleMergeDelta(input:ZpotDeltaInput):ZpotDeltaReport{
 const ignored=new Set(['id','creationDate','lastUpdateDate','createdBy','lastUpdatedBy','abcsChangeNumber']);
 const out:ZpotDeltaReport={tables:{},operations:[],report:[],
  totals:{existing:0,unchanged:0,updates:0,inserts:0,totalWrites:0}};
 const norm=(value:unknown)=>String(value??'');
 for(const name of Object.keys(input.merged).sort()){
  const baseline=input.baseline[name]||{columns:[],rows:[]};
  const merged=input.merged[name];
  const existing=new Map<string,ZpotDeltaRow>();
  for(const row of baseline.rows){
   const id=norm(row.id).trim();
   if(!id)throw Error('El ZIP marcado como existente contiene un ID vacío: '+name);
   if(existing.has(id))throw Error('El ZIP marcado como existente contiene IDs duplicados: '+name+'/'+id);
   existing.set(id,row);
  }
  const rows:ZpotDeltaRow[]=[];
  let unchanged=0,updates=0,inserts=0;
  const seen=new Set<string>();
  for(const row of merged.rows){
   const id=norm(row.id).trim();
   if(!id||seen.has(id))throw Error('ID consolidado vacío o repetido en '+name+'/'+id);
   seen.add(id);
   const prior=existing.get(id);
   if(!prior){
    rows.push({...row});
    inserts++;
    out.operations.push({object:name,id,action:'create',
      changedFields:merged.columns.filter(key=>!ignored.has(key)&&norm(row[key])!=='')});
    continue;
   }
   const changedFields=merged.columns.filter(key=>!ignored.has(key)&&
     norm(row[key])!==''&&norm(row[key])!==norm(prior[key]));
   if(!changedFields.length){unchanged++;continue;}
   // Preserve primary ID and only fields that actually changed. The shared
   // Publisher skips blank values, preventing implicit null/erase operations.
   const patchRow:ZpotDeltaRow={id};
   for(const key of changedFields)patchRow[key]=norm(row[key]);
   rows.push(patchRow);updates++;
   out.operations.push({object:name,id,action:'update',changedFields});
  }
  const columns=[...new Set(['id',...merged.columns.filter(c=>rows.some(r=>r[c]!==undefined))])];
  if(rows.length)out.tables[name]={columns,rows};
  out.report.push({object:name,baseline:baseline.rows.length,consolidated:merged.rows.length,unchanged,updates,inserts});
  out.totals.existing+=baseline.rows.length;out.totals.unchanged+=unchanged;
  out.totals.updates+=updates;out.totals.inserts+=inserts;
 }
 out.totals.totalWrites=out.totals.updates+out.totals.inserts;
 return out;
}
(globalThis as typeof globalThis & {ZPOTOracleMergeDelta?:{build:typeof buildOracleMergeDelta}}).ZPOTOracleMergeDelta={build:buildOracleMergeDelta};
