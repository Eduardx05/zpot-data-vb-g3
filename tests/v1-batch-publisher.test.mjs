import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';

test('V1 original remains and independent Oracle batch+parallel menu renders the V1 publisher',()=>{
 const html=readFileSync('public/index.template.html','utf8');
 const batch=readFileSync('public/oracle-v1-batch-publish.js','utf8');
 new Script(batch,{filename:'oracle-v1-batch-publish.js'});
 assert.match(html,/data-page="publicar"/);
 assert.match(html,/data-page="publicar-batch"/);
 assert.match(html,/Publicar Oracle con batch y paralelo/);
 assert.match(html,/section==='publicar'\?renderPublish\(\):section==='publicar-batch'\?window\.ZPOTV1BatchPublish\.render\(\)/);
 assert.match(html,/if\(section==='publicar-batch'\)window\.ZPOTV1BatchPublish\.publish\(\);else pubSend\(\)/);
 assert.match(batch,/let html=renderPublish\(\)/);
 assert.match(batch,/pubGetPlan\(\)/);
 assert.match(batch,/pubConsolidated\(table\)/);
 assert.match(batch,/pubPayload\(t,row,cols\)/);
 assert.match(batch,/pubCheckRowReferences\(/);
 assert.match(batch,/pubFindUnique\(/);
 assert.match(batch,/\/api\/oracle-batch/);
 assert.match(batch,/ZPOTOracleBatchRunner/);
 assert.match(batch,/batchSize:B\.size,concurrency:B\.concurrency/);
 assert.match(batch,/safeToResume/);
 assert.match(batch,/needs-reconciliation/);
 assert.match(batch,/CARGAR DESARROLLO/);
 assert.match(batch,/detenida por el usuario/);
 assert.match(batch,/Upsert-Mode no se admite/);
 const server=readFileSync('src/server.ts','utf8');
 assert.match(server,/\/oracle-v1-batch-publish\.js/);
});

test('batch runner uses mapped Oracle ID for PATCH, preserves source ID in audit',async()=>{
 const ctx={};
 runInNewContext(readFileSync('dist/public/oracle-batch-runner.js','utf8'),ctx);
 let called,confirmed;
 const rows=[{id:'5',name:'Updated'}];
 const result=await ctx.ZPOTOracleBatchRunner.run({
  changes:[{object:'AbsenceTypeCatalogue',id:'5',targetId:'105',action:'update',changedFields:['name']}],
  tables:{AbsenceTypeCatalogue:{columns:['id','name'],rows}},
  relations:{},stages:[['AbsenceTypeCatalogue']],batchSize:10,concurrency:2,
  normalize:(_,row)=>({...row}),
  send:async parts=>{
   called=parts;
   return {parts:parts.map(part=>({id:part.id,operation:part.operation,status:200,payload:{}}))};
  },
  onCommit:batch=>confirmed=batch
 });
 assert.equal(called[0].path,'/AbsenceTypeCatalogue/105');
 assert.equal(Object.hasOwn(called[0].payload,'id'),false);
 assert.equal(confirmed.operations[0].sourceId,'5');
 assert.equal(confirmed.operations[0].oracleId,'105');
 assert.equal(result.mappings.AbsenceTypeCatalogue['5'],'105');
});

test('batch runner refuses malformed remapped target IDs before any requests',async()=>{
 const ctx={};
 runInNewContext(readFileSync('dist/public/oracle-batch-runner.js','utf8'),ctx);
 let called=0;
 await assert.rejects(ctx.ZPOTOracleBatchRunner.run({
  changes:[{object:'Cases',id:'1',targetId:'../../secrets',action:'update',changedFields:[]}],
  tables:{Cases:{columns:['id'],rows:[{id:'1'}]}},
  relations:{},stages:[['Cases']],batchSize:10,concurrency:1,
  normalize:(_,row)=>({...row}),send:async()=>{called++;return {parts:[]}}
 }),/BO o ID inválido/);
 assert.equal(called,0);
});
