import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const html=readFileSync('public/index.template.html','utf8');

test('importing a previously created BO map forces ID sync and forbids blindly repeating POST',()=>{
 assert.match(html,/PUB\.mode='sync';\s*render\(\);\s*pubSetStatus\('Importadas/);
 assert.match(html,/\['create','upsert'\]\.includes\(PUB\.mode\)&&\(/);
 assert.match(html,/PUB\.restoredCount>0\|\|Object\.keys\(session\?\.idMap/);
 assert.match(html,/if\(\['create','upsert'\]\.includes\(x\.value\)&&PUB\.restoredCount>0\)/);
 assert.match(html,/PUB\.mode=raw\.mode==='update'\?'update':'sync'/);
 assert.match(html,/if\(raw\.tables\?\.some\(t=>Number\(t\.planned\)>1000\)\)PUB\.limit='ALL'/);
 assert.match(html,/const resolved=await pubRecoverSkippedParent\(session,parent,id,base\)/);
});

test('legacy create audit with known Oracle IDs resumes at the first unprocessed BO in sync mode',async()=>{
 const start=html.indexOf('async function pubUpgradeLegacyAudit(');
 const end=html.indexOf('async function pubResumeFromJson(',start);
 assert.ok(start>0&&end>start);
 const ctx={
  PUB:{mode:'create',url:'https://oracle.test',limit:'1',preserveIds:true,includeEmpty:false,skipConflicts:true,stepMode:true,autoStartNext:false},
  PUB_CHECKPOINT_FORMAT:'BNCR-ZPOT-RESUME-v1',
  D:[{filename:'original.zip',sha:'sha-one',isDemo:false}],conSchema:0,
  consolidation:new Set([0]),schemaMode:'reference',includeMode:'all',
  window:{confirm:()=>true,ZPOTOracleIdTools:{
   createRegistry:()=>{
    const data={};
    return {load:obj=>{for(const [table,rows] of Object.entries(obj||{})){
     data[table]??={};
     for(const [source,target] of Object.entries(rows)){
      if(data[table][source]&&data[table][source]!==target)throw Error('Conflicting mapping');
      data[table][source]=target;
     }
     }},snapshot:()=>JSON.parse(JSON.stringify(data))};
   },
   sortSelfRows:(_table,rows)=>rows.slice()
  }},
  pubUrlTemplate:()=> 'https://oracle.test',pubIsConfirmedDevTarget:()=>true,
  pubRecoveryFingerprint:()=> 'verified-fingerprint',
  pubSelectedTables:()=>[...ctx.PUB.tableSet],
  pubGetPlan:()=>({stages:[['AprobationCatalogue'],['Cases']],order:['AprobationCatalogue','Cases']}),
  pubConsolidated:async table=>({rows:table==='AprobationCatalogue'?[{id:'1'},{id:'2'}]:[{id:'100'}],cols:['id']}),
  pubRelationships:()=>({}),pubLog:()=>{},
  Error,Set,Map,Array,Object,Number,String,JSON,Date
 };
 const source=html.slice(start,end);
 runInNewContext(source,ctx,{filename:'legacy-upgrade.js'});
 const audit={
  format:'BNCR-ZPOT-Oracle-BO-API-v3',
  url:'https://oracle.test',mode:'create',preserveIds:true,skipConflicts:true,
  sources:[{name:'Original',filename:'original.zip'}],
  plan:{stages:[['AprobationCatalogue'],['Cases']]},
  total:3,success:2,created:2,updated:0,skipped:0,failed:0,operationsTruncated:false,
  operations:[
   {object:'AprobationCatalogue',originalId:'1',oracleId:'1',operation:'created'},
   {object:'AprobationCatalogue',originalId:'2',oracleId:'9',operation:'created'}
  ],
  idMappings:{AprobationCatalogue:{'1':'1','2':'9'}},
  skippedRecords:[],skippedTruncated:false,
  stages:[{stage:1,status:'completed'}],tables:[],errors:[]
 };
 const checkpoint=await ctx.pubUpgradeLegacyAudit(audit);
 assert.equal(ctx.PUB.mode,'sync');
 assert.equal(checkpoint.state.mode,'sync');
 assert.equal(checkpoint.report.originalMode,'create');
 assert.equal(checkpoint.state.nextStage,1);
 assert.deepEqual(JSON.parse(JSON.stringify(checkpoint.state.cursor)),{stageIndex:1,tableIndex:0,rowIndex:0});
 assert.equal(checkpoint.state.idMappings.AprobationCatalogue['1'],'1');
 assert.equal(checkpoint.state.idMappings.AprobationCatalogue['2'],'9');
 assert.deepEqual(Array.from(checkpoint.state.successfulIds.AprobationCatalogue),['1','2']);
});
