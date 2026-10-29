import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

const PORT=19674;
const SERVER='http://127.0.0.1:'+PORT;
async function startServer(){
  const proc=spawn(process.execPath,['dist/server.js'],{env:{...process.env,PORT:String(PORT),HOST:'127.0.0.1',ENABLE_ORACLE_WRITES:'false',ORACLE_AUTH_MODE:'public'},stdio:['ignore','pipe','pipe']});
  for(let i=0;i<80;i++){
    try{const r=await fetch(SERVER+'/api/health');if(r.ok)return proc}catch{}
    await new Promise(r=>setTimeout(r,60));
  }
  proc.kill();throw Error('No inició servidor ZPOT');
}
test('proxy local: estado, inyección de datos y escritura cerrada por defecto',async()=>{
  const proc=await startServer();
  try{
    const status=await (await fetch(SERVER+'/api/health')).json();
    assert.equal(status.writeEnabled,false);
    assert.equal(status.authMode,'public');
    const html=await (await fetch(SERVER+'/')).text();
    assert.match(html,/ZPOT/);
    assert.doesNotMatch(html,/__ZPOT_(REFERENCE|SOURCES|PACKS)_DATA__/);
    assert.match(html,/\/api\/oracle/);
    const denied=await fetch(SERVER+'/api/oracle/Configuration',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(denied.status,403);
    const invalid=await fetch(SERVER+'/api/oracle/Bad-Object');
    assert.equal(invalid.status,400);
    const originDenied=await fetch(SERVER+'/api/health',{headers:{Origin:'null'}});
    assert.equal(originDenied.status,403);
  }finally{proc.kill();}
});
