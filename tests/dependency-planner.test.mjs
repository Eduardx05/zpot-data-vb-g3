import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync('dist/public/dependency-planner.js','utf8');
const plan=(names,relations)=>{const ctx={};runInNewContext(source,ctx);return ctx.ZPOTDependencyPlanner(names,relations)};
const selection=()=>{const ctx={};runInNewContext(source,ctx);return ctx.ZPOTDependencySelection};
test('AbsenceCatalogue after both parent catalogs',()=>{
 const p=plan(['AbsenceCatalogue','AbsenceTypeCatalogue','AbsenceLapseCatalogue'],{
 AbsenceCatalogue:[{field:'absenceTypeCatalogue',target:'AbsenceTypeCatalogue'},{field:'absenceLapseCatalogue',target:'AbsenceLapseCatalogue'}]});
 assert.deepEqual(Array.from(p.stages,x=>Array.from(x)),[['AbsenceLapseCatalogue','AbsenceTypeCatalogue'],['AbsenceCatalogue']]);
 assert.equal(p.edges.length,2);
});
test('ProcessStageProcess follows Process and ProcessStages; CaseStage follows Cases',()=>{
 const p=plan(['CaseStage','ProcessStageProcess','Cases','Process','ProcessStages','CaseStageStatus'],{
 ProcessStageProcess:[{field:'process',target:'Process'},{field:'processStages',target:'ProcessStages'}],
 CaseStage:[{field:'cases',target:'Cases'},{field:'processStages',target:'ProcessStages'},{field:'caseStageStatus',target:'CaseStageStatus'}]});
 assert.ok(p.stages.findIndex(s=>s.includes('ProcessStageProcess'))>p.stages.findIndex(s=>s.includes('Process')));
 assert.ok(p.stages.findIndex(s=>s.includes('CaseStage'))>p.stages.findIndex(s=>s.includes('Cases')));
});
test('missing parent is external: verify by API, do not invent a parent',()=>{
 const p=plan(['AbsenceCatalogue'],{AbsenceCatalogue:[{field:'absenceTypeCatalogue',target:'AbsenceTypeCatalogue'}]});
 assert.equal(p.stages.length,1);assert.equal(p.external.length,1);
 assert.equal(p.external[0].parent,'AbsenceTypeCatalogue');
});
test('cycles block objects and descendants',()=>{
 const p=plan(['A','B','C','D'],{A:[{field:'b',target:'B'}],B:[{field:'a',target:'A'}],C:[{field:'b',target:'B'}]});
 assert.deepEqual(Array.from(p.cycles,x=>Array.from(x)),[['A','B']]);
 assert.deepEqual(Array.from(p.unplanned),['A','B','C']);
 assert.deepEqual(Array.from(p.stages,x=>Array.from(x)),[['D']]);
});
test('duplicate relationships are ignored and self-reference is warned',()=>{
 const p=plan(['A','B'],{B:[{field:'x',target:'A'},{field:'x',target:'A'},{field:'self',target:'B'}]});
 assert.equal(p.edges.length,1);assert.equal(p.selfReferences.length,1);assert.deepEqual(Array.from(p.order),['A','B']);
});

test('selecting a child auto-selects all available parents across multiple levels',()=>{
 const rel={
  CaseStage:[{field:'case',target:'Cases'},{field:'stage',target:'ProcessStages'},{field:'status',target:'CaseStageStatus'}],
  Cases:[{field:'process',target:'Process'}],
  ProcessStages:[{field:'process',target:'Process'}]
 };
 const result=selection().withParents(['CaseStage'],
   ['CaseStage','Cases','Process','ProcessStages','CaseStageStatus','Unrelated'],rel);
 assert.deepEqual(Array.from(result.selected),['CaseStage','CaseStageStatus','Cases','Process','ProcessStages']);
 assert.deepEqual(Array.from(result.added),['CaseStageStatus','Cases','Process','ProcessStages']);
 assert.deepEqual(Array.from(result.missing),[]);
 const p=plan(result.selected,rel);
 assert.ok(p.stages.findIndex(stage=>stage.includes('Process'))<p.stages.findIndex(stage=>stage.includes('Cases')));
 assert.ok(p.stages.findIndex(stage=>stage.includes('Cases'))<p.stages.findIndex(stage=>stage.includes('CaseStage')));
});

test('unavailable parents remain external; they are not selected from other ZIPs',()=>{
 const r=selection().withParents(['AbsenceCatalogue'],['AbsenceCatalogue','AbsenceTypeCatalogue'],{
  AbsenceCatalogue:[{field:'type',target:'AbsenceTypeCatalogue'},{field:'lapse',target:'AbsenceLapseCatalogue'}]
 });
 assert.deepEqual(Array.from(r.selected),['AbsenceCatalogue','AbsenceTypeCatalogue']);
 assert.deepEqual(Array.from(r.missing),['AbsenceCatalogue → AbsenceLapseCatalogue']);
});

test('removing selected parent also removes transitive dependents but not unrelated objects',()=>{
 const r=selection().withoutParent(['Process','Cases','CaseStage','ProcessStages','Unrelated'],'Process',{
  Cases:[{field:'process',target:'Process'}],
  CaseStage:[{field:'case',target:'Cases'},{field:'stage',target:'ProcessStages'}]
 });
 assert.deepEqual(Array.from(r.removed),['CaseStage','Cases','Process']);
 assert.deepEqual(Array.from(r.selected),['ProcessStages','Unrelated']);
});

test('dependency selection handles cycles and multiple parents without looping',()=>{
 const rel={A:[{field:'b',target:'B'}],B:[{field:'a',target:'A'}],C:[{field:'a',target:'A'},{field:'b',target:'B'}]};
 const s=selection();
 const r=s.withParents(['C'],['A','B','C'],rel);
 assert.deepEqual(Array.from(r.selected),['A','B','C']);
 const removed=s.withoutParent(r.selected,'A',rel);
 assert.deepEqual(Array.from(removed.removed),['A','B','C']);
});

test('CSV-only exports infer Absence FK relations from exact column names',()=>{
 const ctx={};runInNewContext(source,ctx);
 const all=['AbsenceCatalogue','AbsenceTypeCatalogue','AbsenceLapseCatalogue','AppraisalUsed','Cases','Unrelated'];
 const absence=ctx.ZPOTDependencyInference('AbsenceCatalogue',
  ['id','absenceTypeCatalogue','absenceLapseCatalogue','encargado'],all);
 assert.deepEqual(absence.map(x=>[x.field,x.target]).sort(),[
  ['absenceLapseCatalogue','AbsenceLapseCatalogue'],
  ['absenceTypeCatalogue','AbsenceTypeCatalogue']
 ]);
 const appraisal=ctx.ZPOTDependencyInference('AppraisalUsed',
  [{name:'id',type:'number'},{name:'cases',type:'number'},{name:'gestion',type:'string'}],all);
 assert.deepEqual(appraisal.map(x=>[x.field,x.target]),[['cases','Cases']]);
 assert.equal(ctx.ZPOTDependencyInference('Unrelated',['customerId','foo','random'],all).length,0);
});
test('Absence business precedence produces Type, Lapse then Absence without inventing an FK',()=>{
 const ctx={};runInNewContext(source,ctx);
 const outgoing={AbsenceCatalogue:ctx.ZPOTDependencyInference('AbsenceCatalogue',
  ['id','absenceTypeCatalogue','absenceLapseCatalogue'],['AbsenceCatalogue','AbsenceTypeCatalogue','AbsenceLapseCatalogue'])};
 const result=ctx.ZPOTDependencyPlanner(['AbsenceCatalogue','AbsenceTypeCatalogue','AbsenceLapseCatalogue'],
  outgoing,[{before:'AbsenceTypeCatalogue',after:'AbsenceLapseCatalogue'}]);
 assert.deepEqual(Array.from(result.stages,stage=>Array.from(stage)),[
  ['AbsenceTypeCatalogue'],['AbsenceLapseCatalogue'],['AbsenceCatalogue']
 ]);
 assert.equal(result.edges.length,2);
 assert.equal(result.orderEdges.length,1);
 assert.equal(result.orderEdges[0].field,'Orden de carga');
 assert.equal(result.edges.some(x=>x.parent==='AbsenceTypeCatalogue'&&x.child==='AbsenceLapseCatalogue'),false);
});
test('CSV-only AppraisalUsed selection pulls in Cases and its available parent chain',()=>{
 const ctx={};runInNewContext(source,ctx);
 const available=['AppraisalUsed','Cases','AprobationCatalogue'];
 const outgoing={
  AppraisalUsed:ctx.ZPOTDependencyInference('AppraisalUsed',['id','cases'],available),
  Cases:ctx.ZPOTDependencyInference('Cases',['id','aprobationCatalogue'],available)
 };
 const expanded=ctx.ZPOTDependencySelection.withParents(['AppraisalUsed'],available,outgoing);
 assert.deepEqual(Array.from(expanded.selected),['AppraisalUsed','AprobationCatalogue','Cases']);
 const planResult=ctx.ZPOTDependencyPlanner(expanded.selected,outgoing);
 assert.deepEqual(Array.from(planResult.stages,stage=>Array.from(stage)),[
  ['AprobationCatalogue'],['Cases'],['AppraisalUsed']
 ]);
});
