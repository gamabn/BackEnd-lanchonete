const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
require('ts-node/register');
const db=require.resolve('../src/database');require.cache[db]={id:db,filename:db,loaded:true,exports:{pool:new Proxy({},{get:()=>()=>{throw Error('Production database forbidden');}})}};
const {loadBaileys}=require('../src/messaging/channels/whatsapp/runtime');
const {loadPersistentAuth}=require('../src/messaging/worker/persistentAuth');
const {connectLocalWhatsApp}=require('../src/messaging/worker/connection');
const {acquireLocalAuth}=require('../src/messaging/worker/localAuth');
const {readLocalBotConfig}=require('../src/messaging/worker/config');
const tick=()=>new Promise(r=>setImmediate(r));
async function settle(){for(let i=0;i<4;i++)await tick();}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
async function fixture(t){
 const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'gama-auth-h8-'));
 t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
 const config=readLocalBotConfig({GAMA_BOT_ENABLED:'true',GAMA_BOT_RESTAURANT_ID:'00000000-0000-4000-8000-000000000001',GAMA_BOT_SESSION_ID:'00000000-0000-4000-8000-000000000002',GAMA_BOT_AUTH_DIR:'.gama-bot-dev/session'},cwd);
 const sdk=await loadBaileys(),sockets=[],logs=[],opened=new EventEmitter();let qr=0;
 const mock={...sdk,default:options=>{
  const ev=new EventEmitter();ev.on('creds.update',update=>Object.assign(options.auth.creds,update));
  const socket={ev,options,user:{id:'own'},ended:false,end(){this.ended=true;},sendMessage:async()=>assert.fail('No messages in auth tests')};
  sockets.push(socket);opened.emit('socket',socket);return socket;
 }};
 return{config,sdk,mock,sockets,logs,opened,qr:()=>qr,start:()=>connectLocalWhatsApp(config,()=>{qr++;},m=>logs.push(m),async()=>mock)};
}
test('existing credentials and keys survive clean worker restart, compatible with SDK multi-file reader',async t=>{
 const f=await fixture(t);let release=await acquireLocalAuth(f.config);
 let worker=await f.start(),auth=f.sockets[0].options.auth;
 f.sockets[0].ev.emit('creds.update',{registered:true,advSecretKey:'test-only-secret'});
 await auth.keys.set({'session':{'user/1:2':Buffer.from([1,2,3])}});
 await worker.stop();await release();
 const official=await f.sdk.useMultiFileAuthState(f.config.authDir);
 assert.equal(official.state.creds.registered,true);
 assert.deepEqual((await official.state.keys.get('session',['user/1:2']))['user/1:2'],Buffer.from([1,2,3]));
 release=await acquireLocalAuth(f.config);worker=await f.start();auth=f.sockets[1].options.auth;
 assert.equal(auth.creds.registered,true);assert.equal(auth.creds.advSecretKey,'test-only-secret');assert.equal(f.qr(),0);
 assert.deepEqual((await auth.keys.get('session',['user/1:2']))['user/1:2'],Buffer.from([1,2,3]));
 await worker.stop();await release();
 assert.equal(f.logs.join('').includes('test-only-secret'),false);
 assert.equal((await fs.stat(path.join(f.config.authDir,'creds.json'))).mode&0o777,0o600);
});
test('linked QR session with registered=false restores using me.id without rewriting its flags',async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config),auth=await loadPersistentAuth(f.sdk,f.config.authDir);
 auth.state.creds.registered=false;
 auth.state.creds.me={id:'5577999999999:1@s.whatsapp.net',name:'Test fixture'};
 await auth.saveCreds();await auth.state.keys.set({session:{fixture:Buffer.from([1,2,3])}});await auth.flush();
 const file=path.join(f.config.authDir,'creds.json'),before=await fs.readFile(file,'utf8');
 const create=f.mock.default;let checked=false;
 f.mock.default=async options=>{
  assert.equal(options.auth.creds.registered,false);assert.equal(options.auth.creds.me.id,auth.state.creds.me.id);
  assert.deepEqual((await options.auth.keys.get('session',['fixture'])).fixture,Buffer.from([1,2,3]));
  checked=true;return create(options);
 };
 const worker=await f.start();assert.equal(checked,true);assert.equal(f.qr(),0);
 assert.ok(f.logs.some(line=>line.includes('identidade vinculada carregada')));
 assert.equal(f.logs.some(line=>line.includes('sem identidade vinculada')),false);
 assert.equal(f.logs.join('').includes(auth.state.creds.me.id),false);
 await worker.stop();await release();assert.equal(await fs.readFile(file,'utf8'),before);
});
test('registered flag alone never claims a linked session when me is absent',async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config),auth=await loadPersistentAuth(f.sdk,f.config.authDir);
 auth.state.creds.registered=true;await auth.saveCreds();const worker=await f.start();
 assert.ok(f.logs.some(line=>line.includes('sem identidade vinculada local')));await worker.stop();await release();
});
test('isolated and integrated flags preserve the same absolute auth directory and session',()=>{
 const env={GAMA_BOT_ENABLED:'true',GAMA_BOT_RESTAURANT_ID:'00000000-0000-4000-8000-000000000001',GAMA_BOT_SESSION_ID:'00000000-0000-4000-8000-000000000002',GAMA_BOT_AUTH_DIR:'.gama-bot-dev/session'};
 const isolated=readLocalBotConfig({...env,WHATSAPP_REAL_CHECKOUT_ENABLED:'false'},'/tmp/gama');
 const integrated=readLocalBotConfig({...env,GAMA_BOT_API_HOST_ENABLED:'true',WHATSAPP_REAL_CHECKOUT_ENABLED:'true'},'/tmp/gama');
 assert.equal(isolated.authDir,integrated.authDir);assert.deepEqual(isolated.context,integrated.context);
});
test('creds.update snapshots are serialized; key writes are awaited before safe lock release',async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config),worker=await f.start();
 const original=fs.open,entered=deferred(),gate=deferred();let held=false;
 fs.open=async(...args)=>{
  if(!held&&String(args[0]).includes('session-blocked.json.')){held=true;entered.resolve();await gate.promise;}
  return original(...args);
 };
 try{
  f.sockets[0].ev.emit('creds.update',{registered:true});
  const pending=f.sockets[0].options.auth.keys.set({session:{blocked:Buffer.from([9])}});await entered.promise;
  let stopped=false;const stopping=worker.stop().then(()=>{stopped=true;});await settle();assert.equal(stopped,false);
  await assert.rejects(()=>acquireLocalAuth(f.config),e=>e.code==='LOCK_PRESENT');
  gate.resolve();await Promise.all([pending,stopping]);await release();
 }finally{gate.resolve();fs.open=original;}
 const restored=await loadPersistentAuth(f.sdk,f.config.authDir);
 assert.deepEqual((await restored.state.keys.get('session',['blocked'])).blocked,Buffer.from([9]));
 assert.equal(restored.state.creds.registered,true);
});
test('atomic credential write failure preserves the previous complete JSON and fails flush',async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config),auth=await loadPersistentAuth(f.sdk,f.config.authDir);
 auth.state.creds.registered=true;await auth.saveCreds();const file=path.join(f.config.authDir,'creds.json'),before=await fs.readFile(file,'utf8');
 const original=fs.rename;fs.rename=async()=>{throw Object.assign(Error('private-data'),{code:'EIO'});};
 try{auth.state.creds.registered=false;await assert.rejects(()=>auth.saveCreds());await assert.rejects(()=>auth.flush());}
 finally{fs.rename=original;}
 assert.equal(await fs.readFile(file,'utf8'),before);assert.equal((await fs.readdir(f.config.authDir)).some(x=>x.endsWith('.tmp')),false);await release();
});
test('key-only write queued by socket.end is drained even without another creds.update',async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config),worker=await f.start();
 const socket=f.sockets[0],original=fs.open,entered=deferred(),gate=deferred();let pending,held=false;
 fs.open=async(...args)=>{if(!held&&String(args[0]).includes('session-final-key.json.')){held=true;entered.resolve();await gate.promise;}return original(...args);};
 socket.end=()=>{setImmediate(()=>{pending=socket.options.auth.keys.set({session:{'final-key':Buffer.from([4])}});});};
 try{
  let stopped=false;const stopping=worker.stop().then(()=>{stopped=true;});await entered.promise;await settle();assert.equal(stopped,false);
  gate.resolve();await stopping;await pending;await release();
 }finally{gate.resolve();fs.open=original;}
 const restored=await loadPersistentAuth(f.sdk,f.config.authDir);assert.deepEqual((await restored.state.keys.get('session',['final-key']))['final-key'],Buffer.from([4]));
});
for(const damaged of ['creds','key','missing-creds'])test(`invalid ${damaged} fails explicitly without resetting auth or opening a socket`,async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config);
 if(damaged!=='missing-creds'){const auth=await loadPersistentAuth(f.sdk,f.config.authDir);await auth.saveCreds();}
 const file=path.join(f.config.authDir,damaged==='creds'?'creds.json':'session-old.json');
 const content=damaged==='missing-creds'?'{}':'{invalid-json';await fs.writeFile(file,content);
 await assert.rejects(()=>f.start(),e=>e.code==='AUTH_FILES_INVALID');assert.equal(f.sockets.length,0);
 assert.equal(await fs.readFile(file,'utf8'),content);await release();
});
test('key deletion and protobuf app-state keys keep SDK-compatible serialization',async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config),auth=await loadPersistentAuth(f.sdk,f.config.authDir);
 await auth.saveCreds();await auth.state.keys.set({'app-state-sync-key':{test:{keyData:Buffer.from([1,2])}},session:{obsolete:Buffer.from([7])}});
 await auth.state.keys.set({session:{obsolete:null}});await auth.flush();
 const restored=await loadPersistentAuth(f.sdk,f.config.authDir);
 assert.equal((await restored.state.keys.get('session',['obsolete'])).obsolete,undefined);
 const key=(await restored.state.keys.get('app-state-sync-key',['test'])).test;assert.deepEqual(Buffer.from(key.keyData),Buffer.from([1,2]));await release();
});
test('close followed by a late creds.update persists before restartRequired reconnect',{timeout:10000},async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config),worker=await f.start();
 t.mock.timers.enable({apis:['setTimeout']});
 const first=f.sockets[0];first.ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:515}}}});
 const reconnected=new Promise(resolve=>f.opened.once('socket',resolve));
 first.ev.emit('creds.update',{registered:true});t.mock.timers.tick(1000);
 await reconnected;
 assert.equal(f.sockets.length,2);assert.equal(f.sockets[1].options.auth.creds.registered,true);
 await worker.stop();await release();assert.equal((await loadPersistentAuth(f.sdk,f.config.authDir)).state.creds.registered,true);
});
for(const [status,code] of [[401,'REAUTH_REQUIRED'],[403,'REAUTH_REQUIRED'],[411,'REAUTH_REQUIRED'],[500,'REAUTH_REQUIRED'],[440,'SESSION_REPLACED']])test(`disconnect ${status} stops explicitly and preserves credentials`,async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config),worker=await f.start();
 f.sockets[0].ev.emit('creds.update',{registered:true});
 f.sockets[0].ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:status},message:'private-token'}}});
 const failure=await worker.done;assert.equal(failure.code,code);await worker.stop();await release();
 assert.equal((await loadPersistentAuth(f.sdk,f.config.authDir)).state.creds.registered,true);assert.equal(f.sockets.length,1);assert.equal(f.logs.join('').includes('private-token'),false);
});
test('shutdown during a pending reconnect cancels it and releases lock after saving',async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config),worker=await f.start();t.mock.timers.enable({apis:['setTimeout']});
 f.sockets[0].ev.emit('creds.update',{registered:true});f.sockets[0].ev.emit('connection.update',{connection:'close'});
 await worker.stop();await release();t.mock.timers.tick(60000);await settle();assert.equal(f.sockets.length,1);
 const again=await acquireLocalAuth(f.config);await again();assert.equal((await loadPersistentAuth(f.sdk,f.config.authDir)).state.creds.registered,true);
});
test('shutdown waits for a socket being constructed by reconnect and closes it safely',{timeout:10000},async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config),worker=await f.start();t.mock.timers.enable({apis:['setTimeout']});
 const create=f.mock.default,entered=deferred(),gate=deferred();
 f.mock.default=options=>{entered.resolve(options);return gate.promise;};
 f.sockets[0].ev.emit('connection.update',{connection:'close'});t.mock.timers.tick(1000);
 const options=await entered.promise;let stopped=false;const stopping=worker.stop().then(()=>{stopped=true;});
 await settle();assert.equal(stopped,false);gate.resolve(create(options));await stopping;await release();
 // The first socket was remotely closed; shutdown must end the replacement being constructed.
 assert.equal(f.sockets.length,2);assert.equal(f.sockets[1].ended,true);assert.equal(f.sockets[1].ev.listenerCount('creds.update'),0);
});
test('failed credentials persistence stops explicitly and keeps the auth lock for inspection',{timeout:10000},async t=>{
 const f=await fixture(t);await acquireLocalAuth(f.config);const worker=await f.start();
 const original=fs.rename;fs.rename=async()=>{throw Object.assign(Error('private secret'),{code:'ENOSPC'});};
 try{
  f.sockets[0].ev.emit('creds.update',{registered:true});const failure=await worker.done;
  assert.equal(failure.stage,'auth_save');assert.equal(failure.code,'ENOSPC');await assert.rejects(()=>worker.stop());
  await assert.rejects(()=>acquireLocalAuth(f.config),e=>e.code==='LOCK_PRESENT');assert.equal(f.logs.join('').includes('private secret'),false);
 }finally{fs.rename=original;}
});
test('session binding prevents parallel instances and accidental auth directory changes',async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config),other={...f.config,authDir:path.join(f.config.authRoot,'other')};
 await assert.rejects(()=>acquireLocalAuth(f.config),e=>e.code==='LOCK_PRESENT');
 await assert.rejects(()=>acquireLocalAuth(other),e=>e.code==='LOCK_PRESENT');
 await Promise.all([release(),release()]);
 await assert.rejects(()=>acquireLocalAuth(other),e=>e.code==='SESSION_AUTH_DIR_CHANGED');
 const again=await acquireLocalAuth(f.config);await again();
});
test('previous Linux boot locks do not block recovery or get deleted',async t=>{
 const f=await fixture(t);await acquireLocalAuth(f.config,async()=>'boot-old');
 const release=await acquireLocalAuth(f.config,async()=>'boot-new');
 assert.equal((await fs.stat(path.join(f.config.authDir,'.worker-boot-old.lock'))).isDirectory(),true);
 await release();assert.equal((await fs.stat(path.join(f.config.authDir,'.worker-boot-old.lock'))).isDirectory(),true);
});
test('unknown legacy lock is preserved and reported without deleting credentials',async t=>{
 const f=await fixture(t),release=await acquireLocalAuth(f.config);await release();
 const legacy=path.join(f.config.authDir,'.worker.lock');await fs.mkdir(legacy);
 await assert.rejects(()=>acquireLocalAuth(f.config),e=>e.code==='LOCK_PRESENT');assert.equal((await fs.stat(legacy)).isDirectory(),true);
});
