const {test}=require('node:test');
const assert=require('node:assert/strict');
require('ts-node/register');
const db=require.resolve('../src/database');
require.cache[db]={id:db,filename:db,loaded:true,exports:{pool:new Proxy({},{get:()=>()=>{throw Error('Production database forbidden');}})}};
const {ApiWhatsAppHost}=require('../src/messaging/worker/apiHost');
const {BotDiagnosticError}=require('../src/messaging/worker/diagnostics');
const config={realCheckoutEnabled:true};
const tick=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
function fixture(){
 const trace=[],done=deferred();const resources={database:{end:()=>assert.fail('Shared pool closed')},io:{close:()=>assert.fail('Shared Socket.IO closed')}};
 const checkout={};
 const f={trace,done,resources,checkout,fail:null};
 const worker={done:done.promise,stop:async()=>{trace.push('stop');if(f.fail==='stop')throw Error('drain failed');done.resolve();}};
 const deps={
  prepare:async(c,host)=>{trace.push('prepare');assert.equal(await host(),resources);if(f.fail==='prepare')throw new BotDiagnosticError('configuration','REAL_CHECKOUT_UNAVAILABLE','Unavailable');return f.fail==='missing'?undefined:checkout;},
  acquire:async()=>{trace.push('acquire');if(f.fail==='acquire')throw Error('locked');return async()=>{trace.push('release');};},
  connect:async(c,qr,log,sdk,injected)=>{trace.push('connect');assert.equal(injected,checkout);if(f.fail==='connect')throw Error('SDK failure');return worker;}
 };
 f.deps=deps;f.worker=worker;f.host=new ApiWhatsAppHost(resources,()=>assert.fail('No real QR'),m=>trace.push(m),deps);return f;
}
test('host shares resources, starts once, drains and unlocks once without closing API resources',async()=>{
 const f=fixture();const originalConsole=console.log;
 await Promise.all([f.host.start(config),f.host.start(config)]);await f.host.start(config);
 assert.deepEqual(f.trace,['prepare','acquire','connect']);
 await Promise.all([f.host.stop(),f.host.stop()]);await tick();
 assert.deepEqual(f.trace,['prepare','acquire','connect','stop','release']);
 assert.equal(console.log,originalConsole);
 await f.host.stop();assert.equal(f.trace.filter(x=>x==='release').length,1);
});
for(const enabled of [false,undefined])test(`API host refuses simulated checkout (${enabled})`,async()=>{
 const f=fixture();await assert.rejects(()=>f.host.start({realCheckoutEnabled:enabled}),e=>e.code==='REAL_CHECKOUT_REQUIRED');assert.deepEqual(f.trace,[]);
});
for(const failure of ['prepare','missing','acquire','connect'])test(`startup failure ${failure}: no fallback, no shared resource shutdown`,async()=>{
 const f=fixture();f.fail=failure;await assert.rejects(()=>f.host.start(config));await f.host.stop();
 assert.equal(f.trace.includes('release'),failure==='connect');
 assert.equal(f.trace.filter(x=>x==='connect').length,failure==='connect'?1:0);
});
test('stop during preflight prevents auth and transport startup',async()=>{
 const f=fixture(),gate=deferred();f.deps.prepare=()=>gate.promise;
 const start=f.host.start(config),stop=f.host.stop();gate.resolve(f.checkout);await Promise.all([start,stop]);assert.deepEqual(f.trace,[]);
});
test('stop during auth acquisition releases lock without connecting',async()=>{
 const f=fixture(),gate=deferred();f.deps.acquire=()=>gate.promise;
 const start=f.host.start(config);await tick();const stop=f.host.stop();
 gate.resolve(async()=>f.trace.push('release'));await Promise.all([start,stop]);assert.deepEqual(f.trace,['prepare','release']);
});
test('stop during connection waits for startup and drain before unlocking',async()=>{
 const f=fixture(),gate=deferred();f.deps.connect=()=>gate.promise;
 const start=f.host.start(config);await tick();const stop=f.host.stop();
 assert.equal(f.trace.includes('release'),false);gate.resolve(f.worker);await Promise.all([start,stop]);assert.deepEqual(f.trace,['prepare','acquire','stop','release']);
});
test('worker failure automatically releases lock and allows explicit restart',async()=>{
 const f=fixture();await f.host.start(config);f.done.resolve(new BotDiagnosticError('connection','RETRY_LIMIT','Stopped'));await tick();await tick();
 assert.ok(f.trace.some(x=>x.includes('RETRY_LIMIT')));assert.equal(f.trace.at(-1),'release');
 const next=deferred();f.worker.done=next.promise;await f.host.start(config);await f.host.stop();
 assert.equal(f.trace.filter(x=>x==='connect').length,2);
});
test('failed drain retains auth lock; a later successful stop releases it',async()=>{
 const f=fixture();await f.host.start(config);f.fail='stop';await assert.rejects(()=>f.host.stop());assert.equal(f.trace.includes('release'),false);
 f.fail=null;await f.host.stop();await tick();assert.equal(f.trace.filter(x=>x==='release').length,1);
});
test('failed auth release keeps its callback so a later stop can retry',async()=>{
 const f=fixture();let attempts=0;
 f.deps.acquire=async()=>async()=>{attempts++;if(attempts===1)throw Error('temporary release failure');};
 await f.host.start(config);await assert.rejects(()=>f.host.stop());
 await tick();await f.host.stop();assert.equal(attempts,2);
});
test('explicit simulation skips checkout preflight and retains the auth lock lifecycle',async()=>{
 const f=fixture(), qr=[];
 f.deps.connect=async (config,renderQr,_log,_sdk,checkout)=>{
  assert.equal(checkout,undefined);
  assert.equal(config.realCheckoutEnabled,false);
  f.trace.push('connect');renderQr('TEST_QR');return f.worker;
 };
 const host=new ApiWhatsAppHost(f.resources,value=>qr.push(value),()=>{},f.deps,undefined,'simulation');
 await assert.rejects(()=>host.start(config),e=>e.code==='SIMULATION_REQUIRES_CHECKOUT_DISABLED');
 assert.deepEqual(f.trace,[]);
 await host.start({realCheckoutEnabled:false});
 assert.deepEqual(qr,['TEST_QR']);
 await host.stop();
 assert.deepEqual(f.trace,['acquire','connect','stop','release']);
});
