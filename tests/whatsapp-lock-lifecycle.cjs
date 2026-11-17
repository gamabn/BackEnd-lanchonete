const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { fork } = require('node:child_process');
require('ts-node/register');
const { acquireLocalAuth } = require('../src/messaging/worker/localAuth');
const { audit } = require('../ops/whatsapp-session-audit.cjs');
const A = '00000000-0000-4000-8000-000000000001', S = '00000000-0000-4000-8000-000000000002';
async function fixture(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gama-lock-life-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 return { context: {restaurant_id:A,session_id:S,channel:'whatsapp'},authRoot:root,authDir:path.join(root,A,S),realCheckoutEnabled:true };
}
test('current process records ownership but a second acquisition still fails closed',async t=>{
 const config=await fixture(t),release=await acquireLocalAuth(config,async()=>'test');t.after(release);
 const owner=JSON.parse(await fs.readFile(path.join(config.authDir,'.worker-test.lock','owner.json'),'utf8'));
 assert.equal(owner.pid,process.pid);assert.equal(owner.boot,'test');assert.ok(owner.instance);assert.ok(owner.lease);
 await assert.rejects(()=>acquireLocalAuth(config,async()=>'test'),e=>e.code==='LOCK_PRESENT');
 await fs.mkdir(path.join(config.authRoot,'.tenants'));
 await fs.writeFile(path.join(config.authRoot,'.tenants',A+'.json'),JSON.stringify({version:1,restaurantId:A,sessionId:S,enabled:true}));
 const report=await audit(config.authRoot,'test');
 assert.equal(report.tenants[0].lockDetails.directory.owner.pid,process.pid);
 assert.equal(report.tenants[0].lockDetails.directory.owner.instance,report.tenants[0].lockDetails.session.owner.instance);
 await release();await release();
 const next=await acquireLocalAuth(config,async()=>'test');await next();
});
test('another live process owns its lock; SIGTERM drains/releases it before reacquisition',{timeout:20000},async t=>{
 const config=await fixture(t),script=path.join(config.authRoot,'worker-test.cjs');
 await fs.writeFile(script,`
 require(${JSON.stringify(require.resolve('ts-node/register'))});
 const {acquireLocalAuth}=require(${JSON.stringify(require.resolve('../src/messaging/worker/localAuth'))});
 (async()=>{
  const release=await acquireLocalAuth(JSON.parse(process.argv[2]),async()=>'test');
  process.on('message',()=>{}); // Keep the isolated worker alive through its IPC channel.
  process.on('SIGTERM',async()=>{await release();process.exit(0);});
  process.send({ready:true});
 })().catch(()=>process.exit(1));
 `);
 const child=fork(script,[JSON.stringify(config)],{silent:true,execArgv:[]});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exited;}});
 await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('Fixture exited before ready')));});
 const owner=JSON.parse(await fs.readFile(path.join(config.authDir,'.worker-test.lock','owner.json'),'utf8'));
 assert.equal(owner.pid,child.pid);assert.notEqual(owner.pid,process.pid);
 await assert.rejects(()=>acquireLocalAuth(config,async()=>'test'),e=>e.code==='LOCK_PRESENT');
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(config.authDir,'.worker-test.lock','owner.json'),'utf8')),owner);
 const exited=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));child.kill('SIGTERM');
 assert.deepEqual(await exited,{code:0,signal:null});
 const release=await acquireLocalAuth(config,async()=>'test');await release();
});
test('release retries a partial filesystem failure without forgetting the remaining lock',async t=>{
 const config=await fixture(t),release=await acquireLocalAuth(config,async()=>'test');
 const blocker=path.join(config.authDir,'.worker-test.lock','unexpected');await fs.writeFile(blocker,'preserve');
 await assert.rejects(release,e=>e.code==='ENOTEMPTY'||e.code==='EEXIST');
 await assert.rejects(()=>acquireLocalAuth(config,async()=>'test'),e=>e.code==='LOCK_PRESENT');
 await fs.unlink(blocker);await release();const again=await acquireLocalAuth(config,async()=>'test');await again();
});
test('an empty lock from an earlier execution in the same boot stays blocked and untouched',async t=>{
 const config=await fixture(t),release=await acquireLocalAuth(config,async()=>'same-boot');await release();
 const lock=path.join(config.authDir,'.worker-same-boot.lock');await fs.mkdir(lock);
 await assert.rejects(()=>acquireLocalAuth(config,async()=>'same-boot'),e=>e.code==='LOCK_PRESENT');
 assert.deepEqual(await fs.readdir(lock),[]);
});
test('release refuses a changed owner instead of removing another lease',async t=>{
 const config=await fixture(t),release=await acquireLocalAuth(config,async()=>'test');
 const ownerFile=path.join(config.authDir,'.worker-test.lock','owner.json');
 const owner=JSON.parse(await fs.readFile(ownerFile,'utf8'));owner.lease='00000000-0000-4000-8000-000000000099';
 await fs.writeFile(ownerFile,JSON.stringify(owner));
 await assert.rejects(release,e=>e.code==='LOCK_OWNER_CHANGED');
 assert.deepEqual(JSON.parse(await fs.readFile(ownerFile,'utf8')),owner);
});
