import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';

const html=readFileSync('public/index.template.html','utf8');

test('automatic next-stage mode starts remaining stages in the same authorized run',()=>{
 const begin=html.indexOf('function pubStageEnd(');
 const end=html.indexOf('async function pubSend()',begin);
 assert.ok(begin>=0&&end>begin,'stage boundary helper must exist');
 const ctx={};
 runInNewContext(html.slice(begin,end),ctx);
 assert.equal(ctx.pubStageEnd(0,6,true,false),1,'manual mode only publishes one stage');
 assert.equal(ctx.pubStageEnd(2,6,true,false),3,'manual resume only publishes next stage');
 assert.equal(ctx.pubStageEnd(0,6,true,true),6,'auto mode includes all six stages');
 assert.equal(ctx.pubStageEnd(2,6,true,true),6,'auto mode resumes at stage three and includes remaining four stages');
 assert.equal(ctx.pubStageEnd(0,6,false,false),6,'legacy continuous mode remains available');
 assert.equal(ctx.pubStageEnd(5,6,true,false),6,'last stage stays within the plan');
});

test('automatic continuation is available as a checkbox and preserved in both JSON formats',()=>{
 assert.match(html,/id="pub-auto-next" type="checkbox"/);
 assert.match(html,/PUB\.autoStartNext\?'checked':''/);
 assert.match(html,/autoStartNext:PUB\.autoStartNext/);
 assert.match(html,/PUB\.autoStartNext=Boolean\(state\.autoStartNext\)/);
 assert.match(html,/if\(x\.id==='pub-auto-next'\)/);
 assert.match(html,/pubStageEnd\(start,plan\.stages\.length,PUB\.stepMode,PUB\.autoStartNext\)/);
 assert.match(html,/session\.cursor=\{stageIndex:stageIndex\+1,tableIndex:0,rowIndex:0\}/);
 assert.match(html,/if\(PUB\.stop\)throw Error\('Publicación detenida por el usuario\.'\)/);
 assert.match(html,/if\(!window\.confirm\(`ENVÍO REAL A ORACLE DESARROLLO/);
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
 for(const [,attributes,source] of scripts){
  if(!/\bsrc\s*=/.test(attributes)&&source.trim())new Script(source);
 }
});

test('changing auto mode does not discard an in-progress checkpoint',()=>{
 assert.doesNotMatch(html,/if\(x\.id==='pub-auto-next'\)[\s\S]{0,180}PUB\.stageSession=null/);
 assert.doesNotMatch(html,/if\(x\.id==='pub-step-mode'\)[\s\S]{0,180}PUB\.stageSession=null/);
});
