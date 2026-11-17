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

test('worker simulation ignores an injected checkout and blocks customer and address writes', async t => {
 const {LocalMessageProcessor}=require('../src/messaging/channels/whatsapp/messages');
 const {BotCart}=require('../src/messaging/core/cart');
 const context={restaurant_id:'00000000-0000-4000-8000-000000000001',session_id:'00000000-0000-4000-8000-000000000002',channel:'whatsapp'};
 const ev=new EventEmitter();
 const sdk={default:()=>({ev,user:{id:'test-account'},end(){}})};
 const checkoutCalls=[];
 const forbiddenCheckout=new Proxy({}, {get:(_target,method)=>{
  checkoutCalls.push(method);throw new Error('Unexpected persistent checkout');
 }});
 let menu;
 t.mock.method(LocalMessageProcessor.prototype,'process',async function(){menu=this.conversationMenu;});
 const worker=await connectLocalWhatsApp({context,authDir:'/unused',authRoot:'/unused',realCheckoutEnabled:false},
  ()=>{},()=>{},async()=>sdk,forbiddenCheckout,async()=>({state:{},saveCreds:async()=>{},flush:async()=>{}}));
 t.after(()=>worker.stop());
 ev.emit('messages.upsert',{});
 assert.ok(menu);
 assert.deepEqual(await menu.customerWriter.createInitialForWhatsApp({}),{kind:'schema_unsupported'});
 assert.deepEqual(await menu.addressGateway.save({}, {}, {}),{kind:'unsupported'});

 const cart=new BotCart();
 cart.add({productId:'product',productName:'Pizza',quantity:1,unitPrice:'10.00'});
 const state={step:'PAYMENT_SELECTION',categories:[],cart,customerId:'customer',
  whatsappPhone:{phone:'5577999999999',source:'senderPn'},fulfillmentMode:'PICKUP',pickupConfirmed:true,
  pickupAddress:{restaurantId:context.restaurant_id,name:'Loja',street:'Rua A',number:'10',neighborhood:'Centro',city:'Cidade'}};
 const sender='test@lid';
 menu.sessions.set(JSON.stringify([context.restaurant_id,context.session_id,sender]),state);
 const send=text=>menu.handle(context.session_id,context.restaurant_id,text,sender);
 assert.match(await send('1'),/Confirmação apenas simulada/);
 assert.match(await send('1'),/Confirmação simulada/);
 assert.equal(state.step,'ORDER_SIMULATED');
 assert.equal(state.completedOrderId,undefined);
 assert.deepEqual(checkoutCalls,[]);
});
