import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';

test('publisher template JavaScript compiles and includes bulk selection/recalculation controls',()=>{
 const html=readFileSync('public/index.template.html','utf8');
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
 let compiled=0;
 for(const [,attrs,body] of scripts){
  if(/\bsrc\s*=|type\s*=\s*["']application\/json/i.test(attrs))continue;
  if(body.trim()){new Script(body,{filename:'zpot-publisher-inline-'+(++compiled)+'.js'});}
 }
 assert.ok(compiled>=2,'expected inline application and publisher scripts');
 assert.match(html,/id="pub-select-all"/);
 assert.match(html,/id="pub-recalculate"/);
 assert.match(html,/id="pub-map-import"/);
 assert.match(html,/id="pub-map-file"/);
 assert.match(html,/id="pub-map-clear"/);
 assert.match(html,/Solo PATCH · actualizar IDs existentes, sin crear/);
 assert.match(html,/mappedTargetId:session\.idMap\.get\(t,sourceId\)/);
 assert.match(html,/delete patchPayload\.id/);
 assert.match(html,/PUB\.restoredMappings=registry\.snapshot\(\)/);
 assert.match(html,/const postBody=JSON\.stringify\(payload\)/);
 assert.match(html,/const patchBody=JSON\.stringify\(patchPayload\)/);
 assert.match(html,/function pubPlanMarkup\(plan\)/);
 assert.match(html,/new Set\(stage\)/);
 assert.match(html,/const selectedPlan=pubGetPlan\(\)/);
 assert.doesNotMatch(html,/stage\.map\(t=>`<code>\$\{esc\(t\)\}<\/code>`\)\.join\(' → '\)/);
});

test('selecting all 104 model BOs generates a duplicate-free and complete ordered plan',()=>{
 const ctx={};
 for(const filename of ['bo-master-model.js','dependency-planner.js'])
  runInNewContext(readFileSync('dist/public/'+filename,'utf8'),ctx);
 const names=Object.keys(ctx.ZPOTBOMasterModel.objects);
 const relations=Object.fromEntries(names.map(name=>[name,ctx.ZPOTBOMasterModel.objects[name].outgoing]));
 const all=ctx.ZPOTDependencySelection.withParents([...names,...names],names,relations);
 const plan=ctx.ZPOTDependencyPlanner(all.selected,relations,[
  {before:'AbsenceTypeCatalogue',after:'AbsenceLapseCatalogue',label:'Orden solicitado (no es FK)'}
 ]);
 const flattened=plan.stages.flat();
 assert.equal(all.selected.length,104);
 assert.equal(flattened.length,104);
 assert.equal(new Set(flattened).size,104);
 assert.equal(plan.unplanned.length,0);
 assert.equal(plan.edges.length,96);
 assert.equal(plan.orderEdges.length,1);
 const level=new Map(flattened.map(name=>[name,plan.stages.findIndex(stage=>stage.includes(name))]));
 for(const edge of plan.edges)assert.ok(level.get(edge.parent)<level.get(edge.child),edge.parent+' precedes '+edge.child);
});
