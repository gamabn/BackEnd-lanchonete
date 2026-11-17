const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
require('ts-node/register');
const db=require.resolve('../src/database');require.cache[db]={id:db,filename:db,loaded:true,exports:{pool:{}}};
const {connectLocalWhatsApp}=require('../src/messaging/worker/connection');
test('structured lifecycle events accompany a mocked connection without exposing auth',async()=>{
 const ev=new EventEmitter(),events=[],qr=[],socket={ev,user:{id:'opaque'},end(){},sendMessage:async()=>{}};
 const sdk={default:()=>socket,DisconnectReason:{loggedOut:401,badSession:500,connectionReplaced:440,multideviceMismatch:411,forbidden:403}};
 const state={creds:{registered:false,me:{id:'private-jid'}},keys:{}};
 const worker=await connectLocalWhatsApp({context:{restaurant_id:'00000000-0000-4000-8000-000000000001',session_id:'00000000-0000-4000-8000-000000000002',channel:'whatsapp'},authDir:'/not-used',authRoot:'/not-used'},value=>qr.push(value),()=>{},async()=>sdk,undefined,async()=>({state,saveCreds:async()=>{},flush:async()=>{}}),event=>events.push(event));
 ev.emit('connection.update',{connection:'connecting',qr:'PRIVATE_QR'});ev.emit('connection.update',{connection:'open'});ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:408}}}});
 await worker.stop();assert.deepEqual(qr,['PRIVATE_QR']);assert.deepEqual(events.map(e=>e.state),['connecting','connected','reconnecting','disconnected']);assert.doesNotMatch(JSON.stringify(events),/PRIVATE_QR|private-jid/);
});
