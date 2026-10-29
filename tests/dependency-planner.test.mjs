import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync('dist/public/dependency-planner.js','utf8');
const plan=(names,relations)=>{const ctx={};runInNewContext(source,ctx);return ctx.ZPOTDependencyPlanner(names,relations)};
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
