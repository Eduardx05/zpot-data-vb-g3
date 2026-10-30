import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const load = file => {
 const ctx={};
 runInNewContext(readFileSync('dist/public/'+file,'utf8'),ctx);
 return ctx;
};

test('existing original ID updates by PATCH, without creating another row',async()=>{
 const fn=load('oracle-record-sync.js').ZPOTOracleRecordSync;
 const calls=[];
 const result=await fn('21',{
  read:async id=>{calls.push('GET '+id);return {status:200,json:{id:21}};},
  update:async id=>{calls.push('PATCH '+id);return {status:200,json:{id:21}};},
  create:async()=>{calls.push('POST');throw Error('unexpected POST');}
 });
 assert.deepEqual(calls,['GET 21','PATCH 21']);
 assert.equal(result.operation,'updated');
});

test('only HTTP 404 allows creating a new record',async()=>{
 const fn=load('oracle-record-sync.js').ZPOTOracleRecordSync;
 const calls=[];
 const result=await fn('22',{
  read:async()=>{calls.push('GET');throw Object.assign(new Error('HTTP 404'),{status:404});},
  update:async()=>{throw Error('unexpected PATCH');},
  create:async()=>{calls.push('POST');return {status:201,json:{id:82}};}
 });
 assert.deepEqual(calls,['GET','POST']);
 assert.equal(result.operation,'created');
 assert.equal(result.result.json.id,82);
});

test('HTTP 403, timeouts and missing IDs never trigger POST',async()=>{
 const fn=load('oracle-record-sync.js').ZPOTOracleRecordSync;
 let created=0;
 for(const err of [Object.assign(new Error('HTTP 403'),{status:403}),new Error('timeout')]){
  await assert.rejects(fn('21',{
   read:async()=>{throw err;},create:async()=>{created++;return {status:201};},update:async()=>({status:200})
  }));
 }
 await assert.rejects(fn('',{read:async()=>({status:404}),create:async()=>{created++;return {}},update:async()=>({})}),/ID original/);
 assert.equal(created,0);
});

test('foreign keys are resolved by source IDs, without matching names',()=>{
 const registry=load('oracle-id-mapping.js').ZPOTOracleIdTools.createRegistry();
 registry.put('Cases',17,901);
 registry.put('ProcessStages',13,13);
 const result=registry.rewrite({id:5,cases:17,processStages:13,title:'No debe usarse para relacionar'},[
  {field:'cases',target:'Cases'},{field:'processStages',target:'ProcessStages'}
 ]);
 assert.equal(result.row.cases,901);
 assert.equal(result.row.processStages,13);
 assert.equal(result.row.title,'No debe usarse para relacionar');
 assert.equal(result.replacements.length,1);
 assert.equal(registry.snapshot().Cases['17'],'901');
});

test('parent rows are ordered before self-referencing children',()=>{
 const tools=load('oracle-id-mapping.js').ZPOTOracleIdTools;
 const ordered=tools.sortSelfRows('Catalog',[
  {id:'3',parent:'2'},{id:'1',parent:''},{id:'2',parent:'1'}
 ],[{field:'parent',target:'Catalog'}]);
 assert.deepEqual(Array.from(ordered,row=>row.id),['1','2','3']);
 assert.throws(()=>tools.sortSelfRows('Catalog',[
  {id:'1',parent:'2'},{id:'2',parent:'1'}
 ],[{field:'parent',target:'Catalog'}]),/circular/);
});
