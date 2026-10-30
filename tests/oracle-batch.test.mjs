import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';

function batchRunner(){
 const ctx={};
 runInNewContext(readFileSync('dist/public/oracle-batch-runner.js','utf8'),ctx);
 return ctx.ZPOTOracleBatchRunner.run;
}
function delta(){
 const ctx={};
 runInNewContext(readFileSync('dist/public/oracle-merge-delta.js','utf8'),ctx);
 return ctx.ZPOTOracleMergeDelta.build;
}
const table=rows=>({columns:[...new Set(rows.flatMap(Object.keys))],rows});
const asJson=x=>JSON.parse(JSON.stringify(x));

test('Oracle batch uses official payload parts with update/create and maps generated parent IDs before children',async()=>{
 const run=batchRunner(),observed=[],commits=[];
 const input={
  changes:[
   {object:'Parent',id:'5',action:'create',changedFields:['name']},
   {object:'Child',id:'80',action:'create',changedFields:['parentId','label']}
  ],
  tables:{
   Parent:table([{id:'5',name:'Catalogo'}]),
   Child:table([{id:'80',parentId:'5',label:'Nueva fila'}])
  },
  relations:{Child:[{field:'parentId',target:'Parent'}]},
  stages:[['Parent'],['Child']],
  batchSize:10,concurrency:2,normalize:(table,row)=>({...row}),
  send:async parts=>{
   observed.push(asJson(parts));
   return {parts:parts.map(part=>({id:part.id,operation:part.operation,payload:{
    ...part.payload,id:part.path==='/Parent'?105:880
   }}))};
  },
  onCommit:record=>commits.push(asJson(record))
 };
 const result=asJson(await run(input));
 assert.equal(result.confirmed,2);
 assert.equal(observed.length,2);
 assert.equal(observed[0][0].path,'/Parent');
 assert.equal(observed[0][0].operation,'create');
 assert.equal(observed[1][0].payload.parentId,'105');
 assert.equal(result.mappings.Parent['5'],'105');
 assert.equal(result.mappings.Child['80'],'880');
 assert.equal(commits.length,2);
});

test('bounded parallelism dispatches at most two batches in one dependency stage',async()=>{
 const run=batchRunner();let current=0,max=0;const batches=[];
 const changes=Array.from({length:23},(_,index)=>({
  object:'CaseStatus',id:String(index+1),action:'update',changedFields:['status']
 }));
 const rows=changes.map(op=>({id:op.id,status:'OK'}));
 const result=asJson(await run({
  changes,tables:{CaseStatus:table(rows)},relations:{},stages:[['CaseStatus']],
  batchSize:5,concurrency:2,normalize:(table,row)=>({...row}),
  send:async parts=>{
   current++;max=Math.max(max,current);
   await new Promise(resolve=>setTimeout(resolve,2));
   batches.push(parts.length);current--;
   return {parts:parts.map(part=>({id:part.id,operation:part.operation,payload:{}}))};
  }
 }));
 assert.equal(result.confirmed,23);
 assert.equal(batches.length,5);
 assert.equal(max,2);
 assert.equal(batches.reduce((a,b)=>a+b,0),23);
});

test('an incomplete batch reply halts without marking any row confirmed',async()=>{
 const run=batchRunner();
 await assert.rejects(run({
  changes:[{object:'Cases',id:'2',action:'update',changedFields:['state']}],
  tables:{Cases:table([{id:'2',state:'New'}])},relations:{},stages:[['Cases']],
  batchSize:10,concurrency:2,normalize:(_,row)=>({...row}),
  send:async()=>({parts:[]})
 }),e=>/no devolvió|sin todas las partes/.test(e.message)&&e.confirmed===0);
});

test('failed parallel batch never dispatches the next wave and preserves confirmed batches',async()=>{
 const run=batchRunner();let calls=0;const commits=[];
 try{
  await run({
   changes:[1,2,3,4,5,6].map(i=>({object:'Cases',id:String(i),action:'update',changedFields:['state']})),
   tables:{Cases:table([1,2,3,4,5,6].map(i=>({id:String(i),state:'Updated'})))},
   relations:{},stages:[['Cases']],batchSize:2,concurrency:2,
   normalize:(_,row)=>({...row}),
   send:async parts=>{
    calls++;
    if(calls===2)throw Error('HTTP 409 rolled back');
    return {parts:parts.map(part=>({id:part.id,operation:'update',payload:{}}))};
   },
   onCommit:b=>commits.push(asJson(b))
  });
  assert.fail('expected failure');
 }catch(error){
  assert.match(error.message,/HTTP 409 rolled back/);
  assert.equal(calls,2,'no third batch should start');
  assert.equal(error.confirmed,2);
  assert.equal(commits.length,1);
 }
});

test('self-referential new rows stop before sending unsafe batches',async()=>{
 const run=batchRunner();let requests=0;
 await assert.rejects(run({
  changes:[
   {object:'Stages',id:'1',action:'create',changedFields:['parent']},
   {object:'Stages',id:'2',action:'create',changedFields:['parent']}
  ],
  tables:{Stages:table([{id:'1',parent:''},{id:'2',parent:'1'}])},
  relations:{Stages:[{field:'parent',target:'Stages'}]},stages:[['Stages']],
  batchSize:10,concurrency:2,normalize:(_,row)=>({...row}),
  send:async()=>{requests++;return {parts:[]};}
 }),/dependencia interna/);
 assert.equal(requests,0);
});

test('batch checkpoint skips confirmed operations and reuses their Oracle mappings',async()=>{
 const run=batchRunner(),observed=[];
 const result=asJson(await run({
  changes:[
   {object:'Parent',id:'5',action:'create',changedFields:['name']},
   {object:'Child',id:'8',action:'create',changedFields:['parentId']}
  ],
  tables:{Parent:table([{id:'5',name:'A'}]),Child:table([{id:'8',parentId:'5'}])},
  relations:{Child:[{field:'parentId',target:'Parent'}]},
  stages:[['Parent'],['Child']],
  batchSize:5,concurrency:1,normalize:(_,row)=>({...row}),
  resume:{completed:{Parent:['5']},mappings:{Parent:{'5':'105'}}},
  send:async parts=>{
   observed.push(asJson(parts));
   return {parts:parts.map(p=>({id:p.id,operation:p.operation,payload:{id:108}}))};
  }
 }));
 assert.equal(observed.length,1);
 assert.equal(observed[0][0].payload.parentId,'105');
 assert.equal(result.confirmed,1);
 assert.equal(result.mappings.Parent['5'],'105');
});

test('differential planner excludes 14,000 unchanged Cases and includes only real changes',()=>{
 const build=delta();
 const old=Array.from({length:14000},(_,i)=>({id:String(i+1),state:'OLD',opportunityNumber:String(i+1)}));
 const merged=old.map(r=>({...r}));
 merged[500].state='UPDATED';
 merged.push({id:'14001',state:'NEW',opportunityNumber:'14001'});
 const result=asJson(build({baseline:{Cases:table(old)},merged:{Cases:table(merged)}}));
 assert.equal(result.totals.existing,14000);
 assert.equal(result.totals.unchanged,13999);
 assert.equal(result.totals.updates,1);
 assert.equal(result.totals.inserts,1);
 assert.equal(result.totals.totalWrites,2);
 assert.equal(result.tables.Cases.rows.length,2);
 assert.equal(result.tables.Cases.rows[0].id,'501');
 assert.equal(result.tables.Cases.rows[0].state,'UPDATED');
 assert.equal(result.tables.Cases.rows[0].opportunityNumber,undefined);
});

test('fusion UI batch controls, parser, proxy restrictions and syntax are present',()=>{
 const ui=readFileSync('public/dual-app-fusion.js','utf8');
 const publish=readFileSync('public/oracle-batch-publish.js','utf8');
 const html=readFileSync('public/index.template.html','utf8');
 const server=readFileSync('src/server.ts','utf8');
 new Script(ui);
 new Script(publish);
 assert.match(ui,/id="fusion-batch-start"/);
 assert.match(ui,/id="fusion-batch-size"/);
 assert.match(ui,/id="fusion-batch-concurrency"/);
 assert.match(ui,/id="fusion-baseline-confirm"/);
 assert.match(ui,/id="fusion-download-delta"/);
 assert.match(publish,/\/api\/oracle-batch/);
 assert.match(publish,/shouldStop:/);
 assert.match(publish,/ZPOTDependencyPlanner/);
 assert.match(publish,/CARGAR DESARROLLO/);
 assert.match(html,/oracle-batch-runner.js/);
 assert.match(html,/oracle-batch-publish.js/);
 assert.match(server,/validateOracleBatch/);
 assert.match(server,/application\/vnd\.oracle\.adf\.batch\+json/);
 assert.match(server,/if\(operation==='update'\)/);
 assert.match(server,/ENABLE_WRITES/);
});
