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
  create:async()=>{created++;throw Object.assign(Error('uniquenessViolation'),{status:400,oracleType:'vbcs://businessObjects/data/uniquenessViolation',oracleDetail:'Non-unique values found for absenceName'});},
  update:async id=>{updates++;assert.equal(id,'7');return {status:200,json:{id:7}};}
 },{findUnique:async()=>{checks++;return checks===1?null:{id:'7',field:'absenceName'};}});
 assert.equal(out.operation,'updated');
 assert.equal(out.targetId,'7');
 assert.equal(created,1);assert.equal(updates,1);
});

test('publisher refuses to PATCH an Oracle ID already reconciled with another source ID',()=>{
 const html=readFileSync('public/index.template.html','utf8');
 assert.match(html,/onTarget:target=>\{/);
 assert.match(html,/const owner=session\.idMap\.ownerOf\(t,target\)/);
 assert.match(html,/if\(owner&&owner!==sourceId\)throw Error\('Colisión de IDs/);
 assert.match(html,/parsed\?\.\['o:errorDetails'\]/);
});

test('Oracle uniqueness violation rescues a case/space mismatch using declared absenceName only',async()=>{
 const names=[{id:35,absenceName:'  CAPACITACIÓN  '}];
 const calls=[];
 const lookup=harness(async url=>{
  calls.push('lookup '+url);
  return {status:200,json:url.includes('&q=')?{items:[],hasMore:false}:{items:names,hasMore:false}};
 });
 const strict=await lookup('AbsenceTypeCatalogue',{id:1,absenceName:'Capacitación'},'https://oracle.test/data');
 assert.equal(strict,null);
 const reconciled=await lookup('AbsenceTypeCatalogue',{id:1,absenceName:'Capacitación'},'https://oracle.test/data','normalized','absenceName');
 assert.equal(reconciled.id,'35');
 assert.equal(reconciled.field,'absenceName');
 const fn=loadSync();
 let posted=0,patched=0;
 const result=await fn('1',{
  read:async id=>{
   if(id==='1')throw Object.assign(new Error('Not found'),{status:404});
   assert.equal(id,'35');
   return {status:200,json:{id:35}};
  },
  create:async()=>{
   posted++;
   throw Object.assign(new Error('HTTP 400: Non-unique values found for absenceName'),{
    status:400,oracleType:'vbcs://businessObjects/data/uniquenessViolation',
    oracleDetail:'Non-unique values found for absenceName'
   });
  },
  update:async id=>{patched++;assert.equal(id,'35');return {status:200,json:{id:35}};}
 },{findUnique:field=>lookup('AbsenceTypeCatalogue',{id:1,absenceName:'Capacitación'},
  'https://oracle.test/data',field?'normalized':'exact',field)});
 assert.equal(result.operation,'updated');
 assert.equal(result.targetId,'35');
 assert.equal(posted,1);
 assert.equal(patched,1);
});

test('normalized values with two Oracle matches are ambiguous and never PATCHed',async()=>{
 const lookup=harness(async url=>({status:200,json:url.includes('&q=')?{items:[],hasMore:false}:{items:[
  {id:33,absenceName:'CAPACITACIÓN'},
  {id:34,absenceName:' capacitación '}
 ],hasMore:false}}));
 await assert.rejects(
  lookup('AbsenceTypeCatalogue',{absenceName:'Capacitación'},'https://oracle.test/data','normalized','absenceName'),
  /varias coincidencias/
 );
});

test('HTTP 400 unrelated to declared uniqueness is never reconciled',async()=>{
 const fn=loadSync();
 let calls=0;
 const error=Object.assign(new Error('invalid value'),{status:400,oracleType:'vbcs://businessObjects/data/validationFailure'});
 await assert.rejects(fn('1',{
  read:async()=>{throw Object.assign(Error('not found'),{status:404});},
  create:async()=>{throw error;},
  update:async()=>{calls++;return {status:200};}
 },{findUnique:async()=>{calls++;return null;}}),/invalid value/);
 assert.equal(calls,1); // precheck only; no retry or PATCH
});

test('uniquenessViolation on unknown field must not choose another unique field',async()=>{
 const fn=loadSync();
 let fields=[];
 await assert.rejects(fn('1',{
  read:async()=>{throw Object.assign(new Error('Not found'),{status:404});},
  create:async()=>{throw Object.assign(new Error('duplicate'),{
   status:400,oracleType:'vbcs://businessObjects/data/uniquenessViolation',
   oracleDetail:'Non-unique values found for someOtherField'
  });},
  update:async()=>{throw Error('unexpected PATCH');}
 },{findUnique:async field=>{fields.push(field);if(!field)return null;throw Error('No matching declared unique field '+field);}}),/someOtherField/);
 assert.deepEqual(fields,[undefined,'someOtherField']);
});

test('missing visible duplicate returns diagnosis rather than retrying POST',async()=>{
 const fn=loadSync();
 const calls=[];
 await assert.rejects(fn('1',{
  read:async id=>{calls.push('GET '+id);throw Object.assign(Error('Not found'),{status:404});},
  create:async()=>{calls.push('POST');throw Object.assign(Error('duplicate'),{
   status:400,oracleType:'vbcs://businessObjects/data/uniquenessViolation',
   oracleDetail:'Non-unique values found for absenceName'
  });},
  update:async()=>{calls.push('PATCH');throw Error('unexpected');}
 },{findUnique:async field=>{
  calls.push('LOOKUP '+(field||'exact'));
  if(field)throw Error('Oracle rechazó la clave única AbsenceTypeCatalogue.absenceName pero no se encontró un único registro visible con GET; revisa permisos de lectura.');
  return null;
 }}),/permisos de lectura/);
 assert.deepEqual(calls,['LOOKUP exact','GET 1','POST','LOOKUP absenceName']);
});
