import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';

const html=readFileSync('public/index.template.html','utf8');
function harness({relations={},reply=async()=>({status:200,json:{id:1}})}={}){
 const start=html.indexOf('function pubSkipError(');
 const end=html.indexOf('async function pubSend(){',start);
 assert.ok(start>0&&end>start,'Recovery helpers must precede publisher');
 const calls=[];
 const ctx={
  PUB:{stop:false},
  pubRelationships:(names)=>Object.fromEntries(names.map(x=>[x,relations[x]||[]])),
  pubEndpoint:(base,table,id)=>base+'/'+table+(id===undefined?'':'/'+id),
  pubFetch:async url=>{calls.push(url);return reply(url);},
  Error,Set,Map,String,Number,Array,Object,RegExp
 };
 runInNewContext(html.slice(start,end),ctx,{filename:'publisher-recovery.js'});
 return {...ctx,calls};
}
function session({success=[],skipped=[],planned={},idMappings={}}={}){
 return {
  successfulIds:new Map(success.map(([table,ids])=>[table,new Set(ids)])),
  skippedIds:new Map(skipped.map(([table,ids])=>[table,new Set(ids)])),
  checkedReferences:new Set(),
  packs:new Map(Object.entries(planned).map(([table,ids])=>[table,{rows:ids.map(id=>({id}))}])),
  idMap:{get:(table,id)=>idMappings[table]?.[id]}
 };
}
test('skipped parent prevents only the affected child from being published',async()=>{
 const {pubCheckRowReferences,calls}=harness({relations:{
  AbsenceCatalogue:[{field:'absenceTypeCatalogue',target:'AbsenceTypeCatalogue'}]
 }});
 const pack={table:'AbsenceCatalogue',rows:[{id:'9',absenceTypeCatalogue:'1'},{id:'10',absenceTypeCatalogue:'2'}]};
 const context=session({skipped:[['AbsenceTypeCatalogue',['1']]],success:[['AbsenceTypeCatalogue',['2']]]});
 await assert.rejects(pubCheckRowReferences(pack,pack.rows[0],context,'https://oracle.test'),error=>{
  assert.equal(error.skipRecord,true);
  assert.match(error.message,/Padre omitido/);
  assert.equal(error.parent,'AbsenceTypeCatalogue');
  assert.equal(error.parentId,'1');
  return true;
 });
 const healthy=await pubCheckRowReferences(pack,pack.rows[1],context,'https://oracle.test');
 assert.equal(healthy.validatedRemote,0);
 assert.deepEqual(calls,[],'no remote calls needed for already confirmed parents');
});
test('missing remote reference omits a row; a valid row still checks and can continue',async()=>{
 const {pubCheckRowReferences,calls}=harness({
  relations:{Child:[{field:'parentId',target:'Parent'}]},
  reply:async url=>{
   if(url.endsWith('/4'))throw Object.assign(new Error('Not found'),{status:404});
   return {status:200,json:{id:5}};
  }
 });
 const context=session();
 const pack={table:'Child',rows:[]};
 await assert.rejects(pubCheckRowReferences(pack,{id:1,parentId:4},context,'https://oracle.test'),error=>error.skipRecord===true&&error.status===404);
 assert.equal((await pubCheckRowReferences(pack,{id:2,parentId:5},context,'https://oracle.test')).validatedRemote,1);
 assert.equal((await pubCheckRowReferences(pack,{id:3,parentId:5},context,'https://oracle.test')).validatedRemote,0);
 assert.equal(calls.length,2,'the successful parent GET is cached');
});
test('planned parent not yet confirmed never silently falls back to source ID',async()=>{
 const {pubCheckRowReferences,calls}=harness({relations:{Child:[{field:'parentId',target:'Parent'}]}});
 const context=session({planned:{Parent:['42']}});
 await assert.rejects(pubCheckRowReferences({table:'Child',rows:[]},{id:77,parentId:42},context,'https://oracle.test'),
  error=>error.skipRecord===true&&/todavía no publicado/.test(error.message));
 assert.equal(calls.length,0);
});
test('Oracle auth and server errors still abort the run rather than being skipped',async()=>{
 const {pubCanSkipIssue,pubCheckRowReferences}=harness({
  relations:{Child:[{field:'parentId',target:'Parent'}]},
  reply:async()=>{throw Object.assign(new Error('Forbidden'),{status:403});}
 });
 assert.equal(pubCanSkipIssue({status:400}),true);
 assert.equal(pubCanSkipIssue({status:404}),true);
 assert.equal(pubCanSkipIssue({status:422}),true);
 assert.equal(pubCanSkipIssue({status:403}),false);
 assert.equal(pubCanSkipIssue({status:502}),false);
 assert.equal(pubCanSkipIssue(new Error('Unexpected JS bug')),false);
 await assert.rejects(pubCheckRowReferences({table:'Child',rows:[]},{parentId:9},session(),'https://oracle.test'),
  error=>!pubCanSkipIssue(error)&&/No fue posible validar/.test(error.message));
});
test('detailed error summary includes Oracle unique field and source value but redacts secrets',()=>{
 const {pubIssueDetails,pubCanSkipIssue}=harness();
 const oracleError=Object.assign(new Error('HTTP 400: Non-unique values found for absenceName'),{
  status:400,oracleType:'vbcs://businessObjects/data/uniquenessViolation',
  oracleDetail:'Non-unique values found for absenceName'
 });
 const issue=pubIssueDetails('AbsenceTypeCatalogue',{id:1,absenceName:'Capacitación'},oracleError,1);
 assert.equal(issue.field,'absenceName');
 assert.equal(issue.fieldValue,'Capacitación');
 assert.equal(issue.id,'1');
 assert.equal(issue.status,400);
 assert.match(issue.oracleType,/uniquenessViolation/);
 assert.equal(pubCanSkipIssue(oracleError),true);
 const secret=pubIssueDetails('Configuration',{id:7,TOKEN:'not-for-output'},Object.assign(new Error('invalid'),{field:'TOKEN',status:400}),1);
 assert.equal(secret.fieldValue,'[oculto]');
});
test('UI includes skip-conflicts switch and records omissions in audit',()=>{
 const inline=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([,attrs])=>!/\bsrc\s*=|type\s*=\s*["']application\/json/i.test(attrs));
 for(const [, , body] of inline)if(body.trim())new Script(body);
 assert.match(html,/id="pub-skip-conflicts"/);
 assert.match(html,/skippedIds:new Map\(\)/);
 assert.match(html,/report\.skippedRecords\.push\(issue\)/);
 assert.match(html,/const references=await pubCheckRowReferences\(pack,r,session,base\)/);
 assert.doesNotMatch(html,/await pubCheckReferences\(session\.packs\.get\(t\)/);
 assert.match(html,/wroteToOracle&&?/, 'guard present before classifier');
});
