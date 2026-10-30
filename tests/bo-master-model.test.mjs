import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function load(){
 const ctx={};
 for(const filename of ['bo-master-model.js','dependency-planner.js']){
  runInNewContext(readFileSync('dist/public/'+filename,'utf8'),ctx);
 }
 return ctx;
}

test('metadata from supplied Visual Builder app covers exactly 104 BO and 96 actual outgoing FK relationships',()=>{
 const ctx=load(),model=ctx.ZPOTBOMasterModel;
 assert.equal(model.coverage.objects,104);
 assert.equal(model.coverage.relationships,96);
 assert.equal(Object.keys(model.objects).length,104);
 assert.equal(Object.values(model.objects).reduce((total,object)=>total+object.outgoing.length,0),96);
 for(const [name,object] of Object.entries(model.objects)){
  for(const relation of object.outgoing){
   assert.ok(model.objects[relation.target],name+' → '+relation.target+' is not in the app');
   assert.match(relation.field,/^[A-Za-z][A-Za-z0-9_]*$/);
   assert.match(relation.name,/entity\.json/);
  }
 }
});

test('master metadata identifies the exact Absence and AppraisalUsed relationships (not inferred)',()=>{
 const m=load().ZPOTBOMasterModel.objects;
 assert.deepEqual(Array.from(m.AbsenceCatalogue.outgoing,x=>[x.field,x.target]).sort(),[
  ['absenceLapseCatalogue','AbsenceLapseCatalogue'],
  ['absenceTypeCatalogue','AbsenceTypeCatalogue']
 ]);
 assert.deepEqual(Array.from(m.AppraisalUsed.outgoing,x=>[x.field,x.target]),[['cases','Cases']]);
 assert.equal(m.AbsenceLapseCatalogue.outgoing.length,0);
 assert.equal(m.AbsenceTypeCatalogue.outgoing.length,0);
});

test('every model object has a dependency-first migration stage and there are no FK cycles',()=>{
 const ctx=load(),names=Object.keys(ctx.ZPOTBOMasterModel.objects);
 const relations=Object.fromEntries(names.map(name=>[name,ctx.ZPOTBOMasterModel.objects[name].outgoing]));
 const plan=ctx.ZPOTDependencyPlanner(names,relations);
 assert.equal(plan.edges.length,96);
 assert.equal(plan.order.length,104);
 assert.equal(plan.unplanned.length,0);
 assert.equal(plan.cycles.length,0);
 assert.equal(plan.stages.length,6);
 const rank=new Map(plan.stages.flatMap((layer,index)=>layer.map(name=>[name,index])));
 for(const edge of plan.edges)
  assert.ok(rank.get(edge.parent)<rank.get(edge.child),edge.parent+' must precede '+edge.child);
});

test('selecting AppraisalUsed includes Cases and all available model parents automatically',()=>{
 const ctx=load(),names=Object.keys(ctx.ZPOTBOMasterModel.objects);
 const relations=Object.fromEntries(names.map(name=>[name,ctx.ZPOTBOMasterModel.objects[name].outgoing]));
 const expanded=ctx.ZPOTDependencySelection.withParents(['AppraisalUsed'],names,relations);
 assert.ok(expanded.selected.includes('Cases'));
 assert.ok(expanded.selected.includes('AprobationCatalogue'));
 assert.ok(expanded.selected.includes('CreditFund'));
 assert.ok(expanded.selected.includes('LegalDocumentCatalogue'));
 assert.ok(expanded.selected.includes('PromiseType'));
});

test('Absence preserves business precedence without manufacturing a Type→Lapse FK',()=>{
 const ctx=load();
 const names=['AbsenceCatalogue','AbsenceLapseCatalogue','AbsenceTypeCatalogue'];
 const rel=Object.fromEntries(names.map(name=>[name,ctx.ZPOTBOMasterModel.objects[name].outgoing]));
 const plan=ctx.ZPOTDependencyPlanner(names,rel,[{before:'AbsenceTypeCatalogue',after:'AbsenceLapseCatalogue'}]);
 assert.deepEqual(Array.from(plan.stages,stage=>Array.from(stage)),[
  ['AbsenceTypeCatalogue'],['AbsenceLapseCatalogue'],['AbsenceCatalogue']
 ]);
 assert.equal(plan.edges.length,2);
 assert.equal(plan.orderEdges.length,1);
});
