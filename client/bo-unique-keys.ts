/** Unique fields declared with unique:true in the user's BNCR Visual Builder entity.json.
 * Generated metadata only: no customer records or environment values.
 * A unique value is used ONLY for exact identity reconciliation, never fuzzy matching.
 */
type ZpotUniqueField = {name:string;type:'string'|'number'};
const ZPOT_UNIQUE_KEYS:Readonly<Record<string,ReadonlyArray<ZpotUniqueField>>> = {
 AbsenceLapseCatalogue:[{name:'lapseType',type:'string'}],
 AbsenceTypeCatalogue:[{name:'absenceName',type:'string'}],
 CaseStageComplex:[{name:'stageRelatedId',type:'number'}],
 CaseStageStatus:[{name:'statusCode',type:'string'}],
 ExclusionCatalogue:[{name:'exclusionName',type:'string'}],
 InvestmenPlan:[{name:'cases',type:'number'}],
 RejectionHistory:[{name:'cases',type:'number'}],
 SarasLevelCatalogue:[{name:'levelName',type:'string'}],
 SarasLimitCatalogue:[{name:'keyCatalog',type:'string'}],
 SarasProcess:[{name:'cases',type:'number'}],
 Users:[{name:'cases',type:'number'}],
 Zones:[{name:'cases',type:'number'}]
};
(globalThis as typeof globalThis & {ZPOTBOUniqueKeys?:typeof ZPOT_UNIQUE_KEYS}).ZPOTBOUniqueKeys=ZPOT_UNIQUE_KEYS;
