import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function harness(responder){
 const html=readFileSync('public/index.template.html','utf8');
 const begin=html.indexOf('const PUB_UNIQUE_FIELDS=');
 const end=html.indexOf('function pubSelectedTables()',begin);
 assert.ok(begin>0&&end>begin,'unique-reconcile publisher integration not found');
 const ctx={
  pubEndpoint:(base,table)=>base+'/'+table,
  pubFetch:responder,
  Error,Set,String,Number,Array,Object,RegExp,encodeURIComponent
 };
 runInNewContext(html.slice(begin,end),ctx);
 return ctx.pubFindUnique;
}
const loadSync=()=>{
 const ctx={};
 runInNewContext(readFileSync('dist/public/oracle-record-sync.js','utf8'),ctx);
 return ctx.ZPOTOracleRecordSync;
};

test('AbsenceTypeCatalogue uniqueness conflict resolves exact absenceName and PATCHes Oracle ID, never POSTs',async()=>{
 const calls=[];
 const lookup=harness(async url=>{
  calls.push('GET '+url);
  assert.match(url,/AbsenceTypeCatalogue\?limit=200&q=absenceName/);
  return {status:200,json:{items:[{id:17,absenceName:'Capacitación'}],hasMore:false}};
 });
 const matched=await lookup('AbsenceTypeCatalogue',{id:1,absenceName:'Capacitación'},'https://oracle.test/data');
 assert.equal(matched.id,'17');
 assert.equal(matched.field,'absenceName');
 const sync=loadSync();
 const result=await sync(1,{
  read:async id=>{calls.push('read '+id);return {status:200,json:{id:17}};},
  update:async id=>{calls.push('PATCH '+id);return {status:200,json:{id:17}};},
  create:async()=>{calls.push('POST');throw Error('Unexpected POST');}
 },{findUnique:async()=>matched});
 assert.equal(result.operation,'updated');
 assert.equal(result.targetId,'17');
 assert.deepEqual(calls.slice(-2),['read 17','PATCH 17']);
 assert.ok(!calls.includes('POST'));
});

test('Oracle q unsupported falls back to exhaustive paginated scan and finds exact unique key',async()=>{
 const urls=[];
 const lookup=harness(async url=>{
  urls.push(url);
  if(url.includes('?limit=200&q='))throw Object.assign(Error('Oracle does not support q'),{status:400});
  return {status:200,json:{items:[{id:99,absenceName:'Otra ausencia'},{id:25,absenceName:'Vacaciones'}],hasMore:false}};
 });
 const result=await lookup('AbsenceTypeCatalogue',{id:1,absenceName:'Vacaciones'},'https://oracle.test/data');
 assert.equal(result.id,'25');
 assert.equal(urls.length,2);
 assert.match(urls[1],/offset=0/);
});

test('empty filtered q response is not blindly considered exhaustive',async()=>{
 const urls=[];
 const lookup=harness(async url=>{
  urls.push(url);
  return {status:200,json:url.includes('&q=')?{items:[],hasMore:false}:{items:[{id:31,absenceName:'Permiso'}],hasMore:false}};
 });
 const result=await lookup('AbsenceTypeCatalogue',{absenceName:'Permiso'},'https://oracle.test/data');
 assert.equal(result.id,'31');
 assert.equal(urls.length,2);
});

test('ambiguous duplicate values never trigger PATCH or POST',async()=>{
 const lookup=harness(async url=>({status:200,json:{items:[
   {id:2,absenceName:'Permiso'}, {id:3,absenceName:'Permiso'}
 ],hasMore:false}}));
 await assert.rejects(lookup('AbsenceTypeCatalogue',{absenceName:'Permiso'},'https://oracle.test/data'),/varias coincidencias/);
});

test('all unique BO fields are sourced from declared constraints, not arbitrary name matching',()=>{
 const lookup=harness(async()=>{throw Error('Should not query BO without declared unique key')});
 assert.equal(typeof lookup,'function');
 const html=readFileSync('public/index.template.html','utf8');
 assert.match(html,/AbsenceTypeCatalogue:\[\{name:'absenceName',type:'string'\}\]/);
 assert.match(html,/err\.oracleType=String\(parsed\?\.type\|\|''\)/);
 assert.match(html,/findUnique=uniqueFields\.length\?async/);
 assert.match(html,/session\.idMap\.ownerOf\(t,matched\.id\)/);
});

test('an exact unique hit with existing restored mapping to another ID is rejected',async()=>{
 const sync=loadSync();
 await assert.rejects(sync(1,{
  read:async()=>({status:200,json:{id:25}}),
  update:async()=>{throw Error('must not patch');},
  create:async()=>{throw Error('must not post');}
 },{mappedTargetId:'21',findUnique:async()=>({id:'25',field:'absenceName'})}),/Conflicto de identidad/);
});

test('400 uniqueness violation can be reconciled after concurrent insert without a blind retry POST',async()=>{
 const sync=loadSync();
 let checks=0,created=0,updates=0;
 const out=await sync(1,{
  read:async id=>{
   if(id==='1')throw Object.assign(Error('not found'),{status:404});
   return {status:200,json:{id:7}};
  },
  create:async()=>{created++;throw Object.assign(Error('uniquenessViolation'),{status:400,oracleType:'vbcs://businessObjects/data/uniquenessViolation'});},
  update:async id=>{updates++;assert.equal(id,'7');return {status:200,json:{id:7}};}
 },{findUnique:async()=>{checks++;return checks===1?null:{id:'7',field:'absenceName'};}});
 assert.equal(out.operation,'updated');
 assert.equal(out.targetId,'7');
 assert.equal(created,1);assert.equal(updates,1);
});
