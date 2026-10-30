import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';

function engine(){
 const ctx={};
 runInNewContext(readFileSync('dist/public/dual-app-merge.js','utf8'),ctx);
 return ctx.ZPOTDualAppMerge.merge;
}
const table=(rows)=>({columns:[...new Set(rows.flatMap(Object.keys))],rows});
const json=x=>JSON.parse(JSON.stringify(x));

test('old catalogs win on declared unique key and new-only catalog values are appended',()=>{
 const merge=engine();
 const result=json(merge({
  oldTables:{AbsenceTypeCatalogue:table([{id:'1',absenceName:'Capacitación',description:'Texto histórico'}])},
  newTables:{AbsenceTypeCatalogue:table([
   {id:'8',absenceName:' CAPACITACIÓN ',description:'Descripción distinta'},
   {id:'1',absenceName:'Licencia',description:'Nuevo valor'}
  ])},
  uniqueKeys:{AbsenceTypeCatalogue:[{name:'absenceName',type:'string'}]}
 }));
 assert.equal(result.totals.blocking,0);
 assert.equal(result.tables.AbsenceTypeCatalogue.rows.length,2);
 assert.equal(result.tables.AbsenceTypeCatalogue.rows[0].description,'Texto histórico');
 assert.equal(result.mappings.old.AbsenceTypeCatalogue['1'],'1');
 assert.equal(result.mappings.new.AbsenceTypeCatalogue['8'],'1');
 assert.equal(result.mappings.new.AbsenceTypeCatalogue['1'],'9');
 assert.equal(result.tables.AbsenceTypeCatalogue.rows[1].id,'9');
});

test('overlapping Cases IDs with distinct opportunityNumber remain distinct and children follow correct origin',()=>{
 const merge=engine();
 const result=json(merge({
  oldTables:{
   Cases:table([{id:'1',opportunityNumber:'OLD-001',state:'EN PROCESO'}]),
   CaseStage:table([{id:'1',cases:'1',status:'Histórico'}])
  },
  newTables:{
   Cases:table([{id:'1',opportunityNumber:'NEW-999',state:'EN PROCESO'}]),
   CaseStage:table([{id:'1',cases:'1',status:'Nuevo'}])
  },
  relations:{CaseStage:[{field:'cases',target:'Cases'}]}
 }));
 assert.equal(result.totals.blocking,0);
 assert.equal(result.tables.Cases.rows.length,2);
 assert.equal(result.tables.CaseStage.rows.length,2);
 assert.notEqual(result.mappings.old.Cases['1'],result.mappings.new.Cases['1']);
 assert.equal(result.tables.CaseStage.rows[0].cases,result.mappings.old.Cases['1']);
 assert.equal(result.tables.CaseStage.rows[1].cases,result.mappings.new.Cases['1']);
});

test('same verified opportunityNumber merges Cases and takes newer updated fields',()=>{
 const result=json(engine()({
  oldTables:{Cases:table([{id:'100',opportunityNumber:'BNCR-ABC',state:'EN PROCESO',lastUpdateDate:'2026-09-01T00:00:00Z'}])},
  newTables:{Cases:table([{id:'2',opportunityNumber:'bncr-abc',state:'FINALIZADO',lastUpdateDate:'2026-10-01T00:00:00Z'}])}
 }));
 assert.equal(result.totals.blocking,0);
 assert.equal(result.tables.Cases.rows.length,1);
 assert.equal(result.tables.Cases.rows[0].state,'FINALIZADO');
 assert.equal(result.tables.Cases.rows[0].id,'100');
 assert.equal(result.mappings.new.Cases['2'],'100');
});

test('Configuration newer values update only with provably later modification date',()=>{
 const result=json(engine()({
  oldTables:{Configuration:table([{id:'3',keyCatalog:'URL_APP',value:'https://old.example',lastUpdateDate:'2026-09-01'}])},
  newTables:{Configuration:table([{id:'90',keyCatalog:'url_app',value:'https://new.example',lastUpdateDate:'2026-10-20'}])}
 }));
 assert.equal(result.tables.Configuration.rows.length,1);
 assert.equal(result.tables.Configuration.rows[0].id,'3');
 assert.equal(result.tables.Configuration.rows[0].value,'https://new.example');
 assert.equal(result.mappings.new.Configuration['90'],'3');
});

test('identical IDs and different content WITHOUT proven identity are never blindly overwritten',()=>{
 const result=json(engine()({
  oldTables:{Process:table([{id:'1',processName:'Original'}])},
  newTables:{Process:table([{id:'1',processName:'Completamente distinto'}])}
 }));
 assert.equal(result.tables.Process.rows.length,2);
 assert.equal(result.tables.Process.rows[0].processName,'Original');
 assert.equal(result.tables.Process.rows[1].processName,'Completamente distinto');
 assert.notEqual(result.mappings.new.Process['1'],result.mappings.old.Process['1']);
});

test('foreign keys to missing parents block publication and remain visible in audit',()=>{
 const result=json(engine()({
  oldTables:{CaseStage:table([{id:'7',cases:'404'}])},
  newTables:{},
  relations:{CaseStage:[{field:'cases',target:'Cases'}]}
 }));
 assert.equal(result.totals.blocking,1);
 assert.equal(result.totals.missingReferences,1);
 assert.match(result.issues[0].message,/Cases/);
});

test('duplicate original IDs and ambiguous unique keys produce blocking issues',()=>{
 const result=json(engine()({
  oldTables:{AbsenceTypeCatalogue:table([{id:'1',absenceName:'Permiso'},{id:'2',absenceName:'PERMISO'}])},
  newTables:{AbsenceTypeCatalogue:table([{id:'1',absenceName:'Licencia'}])},
  uniqueKeys:{AbsenceTypeCatalogue:[{name:'absenceName'}]}
 }));
 assert.ok(result.totals.blocking>0);
});

test('14,000 historical Cases can be consolidated with new entries in linear-memory indexes',()=>{
 const historical=Array.from({length:14000},(_,i)=>({id:String(i+1),opportunityNumber:'OLD-'+String(i+1)}));
 const newer=[{id:'1',opportunityNumber:'NEW-ONE'}, {id:'14001',opportunityNumber:'NEW-14001'}];
 const result=engine()({
  oldTables:{Cases:table(historical)},
  newTables:{Cases:table(newer)}
 });
 assert.equal(result.totals.old,14000);
 assert.equal(result.totals.new,2);
 assert.equal(result.totals.result,14002);
 assert.equal(result.totals.blocking,0);
 assert.ok(result.mappings.new.Cases['1']!=='1');
});

test('fusion is an independent page with ZIP/JSON download and explicit handoff to existing publisher',()=>{
 const html=readFileSync('public/index.template.html','utf8');
 const ui=readFileSync('public/dual-app-fusion.js','utf8');
 new Script(ui,{filename:'dual-app-fusion.js'});
 assert.match(html,/data-page="fusionar"/);
 assert.match(html,/section==='fusionar'\?window\.ZPOTDualFusionUI\.render\(\)/);
 assert.match(ui,/id="fusion-old"/);
 assert.match(ui,/id="fusion-new"/);
 assert.match(ui,/id="fusion-destination"/);
 assert.match(ui,/id="fusion-analyze"/);
 assert.match(ui,/id="fusion-download"/);
 assert.match(ui,/id="fusion-json"/);
 assert.match(ui,/id="fusion-publish"/);
 assert.match(ui,/window\.confirm\('Se preparará el ZIP fusionado/);
 assert.match(ui,/PUB\.mode='sync'/);
 assert.doesNotMatch(ui,/fetch\([^\n]*method:\s*'POST'/);
});
