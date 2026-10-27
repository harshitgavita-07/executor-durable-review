import fs from 'node:fs/promises';import {openSync,closeSync,readFileSync} from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const bin=process.env.EXECUTOR_BIN||path.join(root,'node_modules/.bin/executor');
const data=process.env.EXECUTOR_TEST_DATA||await fs.mkdtemp(path.join(os.tmpdir(),'review-proof-'));
const env={...process.env,EXECUTOR_DATA_DIR:data,EXECUTOR_NO_UPDATE_CHECK:'1',EXECUTOR_PORT:process.env.EXECUTOR_TEST_PORT||'4417'};
const cli=(...args)=>{const log=path.join(data,'command-'+Date.now()+'.log'),fd=openSync(log,'w');try{execFileSync(bin,args,{env,encoding:'utf8',stdio:['ignore',fd,fd],timeout:45000});}catch(e){console.error(readFileSync(log,'utf8'));throw e;}finally{closeSync(fd);}return readFileSync(log,'utf8');};
const checks=[];let headers,url;
async function connect(){
 const status=cli('service','status');url=status.match(/http:\/\/[^\s]+/)[0];
 const {apiKey}=JSON.parse(await fs.readFile(path.join(data,'keys.json'),'utf8'));
 headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:`Bearer ${apiKey}`};
 const r=await fetch(url+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'durable-review-synthetic-tests',version:'1'}}})});
 if(!r.ok)throw new Error(await r.text());headers['Mcp-Session-Id']=r.headers.get('Mcp-Session-Id');await r.text();
}
async function rpc(name,args){const r=await fetch(url+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});const raw=await r.text();let d;try{d=JSON.parse(raw);}catch{d=JSON.parse(raw.split('\n').find(x=>x.startsWith('data: ')).slice(6));}if(d.error)throw new Error(JSON.stringify(d.error));const result=d.result;if(result.isError)throw new Error(JSON.stringify(result));return result.structuredContent||JSON.parse(result.content[0].text);}
const tool=(name,input={})=>rpc('call',{calls:{path:`tools["durable-review"].${name}`,input}});
function value(d){assert.equal(d.status,'completed');assert.equal(d.execution.ok,true,JSON.stringify(d));assert.equal(d.execution.value.ok,true,JSON.stringify(d));return d.execution.value.value;}
async function call(name,input={}){return value(await tool(name,input));}
function check(name){checks.push(name);console.log('PASS '+name);}
async function review(id,digest,decision='approve',action='accept'){
 const pending=await tool('decide',{id,expectedDigest:digest,decision,reason:'Synthetic integration test, not a human attestation'});
 assert.equal(pending.status,'approval-required',JSON.stringify(pending));
 return await rpc('resume',{requestId:pending.requestId,response:{action,content:{}}});
}
async function terminal(id,expected){for(let i=0;i<35;i++){const row=await call('inspect',{id});if(row.state===expected)return row;await new Promise(r=>setTimeout(r,1000));}throw new Error('Timed out waiting for '+expected);}
try{
 cli('service','set','port',env.EXECUTOR_PORT);cli('service','start');await connect();
 const app=JSON.parse(cli('apps','create','--name','Durable review','--files',path.join(root,'app')));
 cli('apps','deploy','--app',app.id,'--files',path.join(root,'app'));
 const discovered=await rpc('search',{namespace:'durable-review'});assert.equal(discovered.items.length,10);check('deployed official framework and discovered all ten operations');
 const req=await call('create',{requestKey:'approve-one',title:'Reviewed note',body:'Exact payload, no external writes',ttlSeconds:600});
 const dup=await call('create',{requestKey:'approve-one',title:'Reviewed note',body:'Exact payload, no external writes',ttlSeconds:600});assert.equal(req.id,dup.id);check('idempotent prepare uses one saved request');
 const conflict=await tool('create',{requestKey:'approve-one',title:'Changed',body:'Changed',ttlSeconds:600});assert.equal(conflict.execution.value.ok,false);check('reused request key cannot change payload');
 const blocked=await call('apply',{id:req.id});assert.equal(blocked.state,'pending');assert.equal((await call('notes')).length,0);check('pending request cannot apply');
 const run=await call('start',{id:req.id}),again=await call('start',{id:req.id});assert.equal(run.id,again.id);check('workflow start recovers the same durable run');
 await new Promise(r=>setTimeout(r,2500));assert.equal((await call('inspect',{id:req.id})).state,'pending');assert(['waiting','running'].includes((await call('runs')).items[0].status));check('workflow remains active waiting for review instead of approval error');
 cli('service','stop');cli('service','start');await connect();assert.equal((await call('inspect',{id:req.id})).state,'pending');check('pending review survives actual runtime restart');
 const wrong=await review(req.id,'0'.repeat(64));assert.equal(wrong.execution.value.ok,false,JSON.stringify(wrong));assert.equal((await call('inspect',{id:req.id})).state,'pending');check('review digest mismatch leaves request pending');
 value(await review(req.id,req.digest));check('exact payload decision passes separate Executor approval');
 await terminal(req.id,'applied');assert.equal((await call('notes')).length,1);check('resumed durable workflow applies one synthetic note');
 const receipts=await Promise.all(Array.from({length:8},()=>call('apply',{id:req.id})));assert(receipts.every(r=>r.state==='applied'));assert.equal((await call('notes')).length,1);check('eight concurrent duplicate applies keep one note');
 const history=await call('history',{id:req.id});assert.deepEqual(history.map(r=>r.event),['prepared','approved','applied']);check('audit trail records prepare, decision, apply once');
 const declined=await call('create',{requestKey:'declined',title:'Not approved',body:'Must not apply',ttlSeconds:600});
 const refusal=await review(declined.id,declined.digest,'approve','decline');assert.equal(refusal.execution.value.ok,false);assert.equal((await call('inspect',{id:declined.id})).state,'pending');check('declining Executor confirmation does not record approval');
 value(await review(declined.id,declined.digest,'reject'));const rejectApply=await call('apply',{id:declined.id});assert.equal(rejectApply.state,'rejected');check('explicit rejection prevents apply');
 const reversed=await review(declined.id,declined.digest,'approve');assert.equal(reversed.execution.value.ok,false);check('rejected decision cannot be reversed');
 const cancelled=await call('create',{requestKey:'cancelled',title:'Cancelled',body:'Must not apply',ttlSeconds:600});await call('start',{id:cancelled.id});await call('cancel',{id:cancelled.id});assert.equal((await call('apply',{id:cancelled.id})).state,'cancelled');check('cancellation prevents apply while workflow waits');
 const expired=await call('create',{requestKey:'expired',title:'Expired',body:'Must not apply',ttlSeconds:20});await call('start',{id:expired.id});await terminal(expired.id,'expired');assert.equal((await call('apply',{id:expired.id})).state,'expired');const late=await review(expired.id,expired.digest);assert.equal(late.execution.value.ok,false);check('real-time expiry prevents late approval and apply');
 assert.equal((await call('notes')).length,1);check('rejected, cancelled, expired and refused paths created no extra notes');
 const report={at:new Date().toISOString(),runtime:cli('--version').trim(),framework:JSON.parse(cli('apps','framework')).version,app:app.id,checks,scope:'Synthetic local SQL only. Programmatic confirmations exercise plumbing; they are not human approvals.'};
 await fs.mkdir(path.join(root,'evidence'),{recursive:true});await fs.writeFile(path.join(root,'evidence','integration.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{try{cli('service','stop');}catch{}}
