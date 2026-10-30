/** 
 * Relationship metadata ONLY from the two user-supplied Visual Builder apps:
 * BNCR_CREDIT_APPROVAL_UUID_SUPPORT_MIGRADO_V5 and BNCR_CREDIT_APPROVAL 3.0.37.
 * Both entity.json models contain the same 104 objects / 96 outgoing FKs.
 * No patient/customer records, credentials, tokens, URLs or role ACLs.
 * Compact source encoding: child_index:exact_mappingField>parent_index.
 * NOTE: import preferences such as Type before Lapse are not foreign keys.
 */
type ZpotMasterRelation = {field:string;target:string;name:string};
type ZpotMasterObject = {outgoing:ZpotMasterRelation[]};
const ZPOT_MASTER_NAMES = "AbsenceCatalogue,AbsenceLapseCatalogue,AbsenceTypeCatalogue,AppraisalUsed,AprobationCatalogue,AuxStage,CaseComplexData,CaseStage,CaseStageComplex,CaseStageCorrection,CaseStageObservation,CaseStageStatus,CaseUpdateHistory,CaseUpdateHistoryLines,Cases,Clasification,Configuration,CorrectionHistory,CorrectionsCatalogue,CreditFund,DeclinationMotive,Declinations,DefaultSchedule,DynamicFlowRole,EconomicActivityCatalog,EmailCase,EnvironmentalSocial,EnvironmentalSocialExcl,ExclusionCatalogue,ExclusionDetail,ExclusionSection,ExpertFormHeader,ExpertFormSeccionA,ExpertFormSeccionB,ExpertFormSeccionC,ExpertFormSeccionD,FilterType,FormCatalogue,FormReference,Guarantee,Historical,HistoricalType,HolidaysHistory,InvestmenPlan,InvestmenPlanHistory,InvestmentPlanCatalogue,InvestmentPlanType,LegalDocumentCatalogue,LocalStorangeDet,Macro,MacroProcessCatalogue,MacroProcessStages,Maintenances,MaintenancesDinamicFlow,Mantenance,MovementsHistory,Notifications,ObservationsManager,OperatingRequirementsCa,Process,ProcessStageProcess,ProcessStages,ProcessStagesDynamicFlo,ProcessStagesInvestment,ProcessVersionByHu,ProdType,Productivity,ProductivityObservation,ProductivityStandBy,ProductivityStatus,PromiseByCase,PromiseType,QualityPromise,ReassignmentHistory,RejectionHistory,RejectionsCatalogue,ReverseHistory,SarasForm,SarasFormDesitionByCase,SarasFormDetSubInfo,SarasFormDetText,SarasLevelCatalogue,SarasLimitCatalogue,SarasMaintenancesCatalo,SarasProcess,SarasReqListOptions,SarasReqSection,SarasRequerimentDetail,SarasRequerimentsCatalo,SarasRequirements,ScheduleByUser,Stages,StandByCatalogue,StandByHistory,SubActivityCatalogue,SubFilter,SubHistorical,SubMacro,SubMaintenances,SubReference,Users,UsersCatalogue,Visits,Zones".split(',');
const ZPOT_MASTER_EDGES = "0:absenceLapseCatalogue>1;0:absenceTypeCatalogue>2;3:cases>14;6:caseStage>7;7:caseStageStatus>11;7:cases>14;7:processStages>61;8:stageRelatedId>61;9:caseStage>7;9:caseStageCorrection>7;9:caseStageNeedCorr>7;10:caseStage>7;10:cases>14;12:cases>14;13:caseUpdateHistory>12;14:aprobationCatalogue>4;14:creditFund>19;14:legalDocumentCatalogue>47;14:promiseType>71;17:caseStage>7;17:cases>14;18:stages>91;20:declinations>21;21:cases>14;25:cases>14;26:cases>14;27:environmental>26;28:exclusionSection>30;29:exclusionCatalogue>28;30:creditFund>19;31:cases>14;32:formHeader>31;33:formHeader>31;34:formHeader>31;35:formHeader>31;38:catalogueParentNumber>37;40:caseStage>7;40:caseStageCorrected>7;40:caseStageStatus>11;40:cases>14;40:historicalType>41;40:standByHistory>93;43:cases>14;44:cases>14;44:investmenPlan>43;45:investmentPlanType>46;51:macro>49;51:processStages>61;55:cases>14;57:caseId>14;60:process>59;60:processStages>61;62:dynamicFlowRole>23;62:processStages>61;63:investmentPlanType>46;63:processStages>61;66:prodType>65;66:productivityStatus>69;67:productivity>66;68:productivity>66;70:cases>14;70:promiseType>71;72:approvalTypeName>4;72:legalDocumentName>47;72:macroProcessName>50;72:process>59;72:processStages>61;73:caseId>14;74:cases>14;74:rejectionsCatalogue>75;76:casesId>14;78:cases>14;79:sarasFormDetText>80;80:subReference>99;84:cases>14;84:exclusionCatalogue>28;85:cases>14;85:sarasReqCat>88;85:sarasReqDetail>87;87:sarasRequerimentsCatalo>88;88:sarasReqSection>86;89:sarasProcess>84;93:caseStage>7;93:cases>14;94:economicActivityCatalog>24;95:filterType>36;96:clasification>15;96:historical>40;96:macro>49;96:subMacro>97;97:macro>49;98:maintenances>52;99:referenceParent>38;100:cases>14;102:cases>14;103:cases>14".split(';');
const ZPOT_MASTER_OBJECTS:Record<string,ZpotMasterObject>=Object.fromEntries(
  ZPOT_MASTER_NAMES.map(name=>[name,{outgoing:[] as ZpotMasterRelation[]}])
);
for(const edge of ZPOT_MASTER_EDGES){
 const match=/^(\d+):([A-Za-z][A-Za-z0-9_]*)>(\d+)$/.exec(edge);
 if(!match)throw Error('Relación de modelo inválida: '+edge);
 const child=ZPOT_MASTER_NAMES[Number(match[1])],target=ZPOT_MASTER_NAMES[Number(match[3])];
 if(!child||!target)throw Error('Nombre de Business Object fuera del modelo: '+edge);
 ZPOT_MASTER_OBJECTS[child].outgoing.push({
  field:match[2],target,name:'Relación declarada en entity.json (modelo BNCR)'
 });
}
if(ZPOT_MASTER_NAMES.length!==104||ZPOT_MASTER_EDGES.length!==96)
 throw Error('El mapa maestro de Visual Builder está incompleto.');
const ZPOT_MASTER_MODEL={
  source:'Exportaciones Visual Builder BNCR V5 y 3.0.37',
  coverage:{objects:ZPOT_MASTER_NAMES.length,relationships:ZPOT_MASTER_EDGES.length},
  objects:ZPOT_MASTER_OBJECTS
};
(globalThis as typeof globalThis & {ZPOTBOMasterModel?:typeof ZPOT_MASTER_MODEL}).ZPOTBOMasterModel=ZPOT_MASTER_MODEL;
