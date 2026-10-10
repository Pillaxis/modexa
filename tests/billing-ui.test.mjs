import 'fake-indexeddb/auto';
import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import {createBillingUI} from '../dist/billing-ui.js';
import {saveLocalModel,listModels,getMeta,removeMeta} from '../dist/local-store.js';
const w=new JSDOM('<dialog id="modal"></dialog>',{url:'https://modexa.test/'}).window;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
const owner='00000000-0000-4000-8000-000000000999';
let sub=null,cloudUsed=10,body,resolveCheckout;
const client={rpc:async()=>({data:{user_id:state.user.id,used:cloudUsed,subscription:sub},error:null}),functions:{invoke:async(_name,args)=>{body=args.body;return new Promise(resolve=>{resolveCheckout=resolve})}}};
const state={user:{id:owner},models:Array.from({length:10},(_,i)=>({id:String(i),dirty:null})),subscription:null,usage:{used:10},billingKnown:true};
const q=s=>w.document.querySelector(s),messages=[];
const api=createBillingUI({state,getClient:()=>client,modal(title,body){q('#modal').innerHTML='<h2>'+title+'</h2>'+body;q('#modal').showModal()},toast:t=>messages.push(t),render(){},requestSync(){},navigate(){},doc:w.document});
try{
 assert.equal(api.canAdd(),false);assert.equal(await api.ensureCanAdd(),false);assert.ok(q('[data-billing-plan=pro]'));assert.ok(q('[data-billing-plan=business]'));
 assert.match(q('.quota-note').textContent,/places/);
 q('[data-billing-months="3"]').click();assert.match(q('.billing-summary').textContent,/18\s900/);assert.match(q('[data-billing-plan=pro]').textContent,/300 nouveaux ajouts/);
 q('[data-billing-plan=business]').click();q('[data-billing-months="12"]').click();assert.match(q('.billing-summary').textContent,/126\s000/);assert.match(q('[data-billing-plan=business]').textContent,/12\s000 nouveaux ajouts/);
 q('[data-billing-pay]').click();assert.equal(q('[data-billing-pay]').disabled,true);assert.equal(body.plan,'business');assert.equal(body.months,12);assert.equal(body.amount,undefined);
 resolveCheckout({data:null,error:{context:{json:async()=>({error:'Réseau indisponible'})}}});await new Promise(r=>setTimeout(r,0));assert.match(q('#checkout-error').textContent,/Réseau/);assert.equal(api.canAdd(),false);
 sub={status:'active',business_until:new Date(Date.now()+86400000).toISOString()};await api.refresh(true);assert.equal(api.canAdd(),true);assert.equal(api.current().limit,1000);
 assert.equal((await getMeta(`subscription:${owner}`)).status,'active');
 // Late checkout responses and subscription results belong only to the initiating session.
 q('[data-billing-pay]').click();const oldCheckout=resolveCheckout;
 api.reset();state.user={id:'00000000-0000-4000-8000-000000000888'};state.subscription=null;
 oldCheckout({data:{url:'https://checkout.fedapay.com/old-account',payment_id:'old-payment'}});
 await new Promise(r=>setTimeout(r,10));
 assert.equal(await getMeta(`pending-payment:${owner}`),undefined,'old payment cannot redirect/store after switching');
 client.rpc=async()=>({data:{user_id:owner,subscription:sub,used:999}});
 await assert.rejects(api.refresh(),/session/);assert.equal(state.subscription,null,'foreign billing response is rejected');
 state.user={id:owner};api.reset();
 // Exhausted active paid credits unlock exactly the matching recharge offers.
 const end=new Date(Date.now()+20*86400000).toISOString();
 state.subscription={plan:'pro',ever_paid:true,status:'active',current_period_end:end};
 state.usage={used:100,quota:{version:2,ever_paid:true,active:true,end,grants:[]}};
 state.models=[];client.rpc=async()=>({data:{user_id:owner,used:100,subscription:state.subscription,quota:state.usage.quota}});
 api.show(true);await new Promise(r=>setTimeout(r,10));
 assert.ok(q('[data-billing-topup="50"]'));assert.ok(q('[data-billing-topup="100"]'));
 assert.equal(q('[data-billing-topup="500"]'),null);
 assert.match(q('.billing-summary').textContent,/3\s600/);
 q('[data-billing-topup="100"]').click();q('[data-billing-pay]').click();
 assert.deepEqual(body,{kind:'topup',plan:'pro',months:1,credits:100});
 resolveCheckout({error:{context:{json:async()=>({error:'Essai'})}}});await new Promise(r=>setTimeout(r,0));
 state.usage.quota.grants=[{total:50,used:0,starts_at:new Date(Date.now()-1000).toISOString(),expires_at:end}];
 api.show();await new Promise(r=>setTimeout(r,10));
 assert.equal(q('[data-billing-kind=topup]').disabled,true,'no stacking unused recharges');
 api.reset();

 // A stalled first quota refresh cannot block durable local saves.
 state.models=[];state.usage=null;state.subscription=null;state.billingKnown=false;
 client.rpc=()=>new Promise(()=>{});
 let timeout;
 try{assert.equal(await Promise.race([api.ensureCanAdd(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Save waited for cloud')),500)})]),true)}finally{clearTimeout(timeout)}
 await removeMeta(`usage:${owner}`);await removeMeta(`subscription:${owner}`);
 // Local transaction protects the last slot against simultaneous saves in two tabs.
 const model=i=>({id:String(i),user_id:owner,name:'Robe bébé',images:[],created_at:new Date().toISOString()});
 for(let i=0;i<9;i++)await saveLocalModel(model(i),[],{limit:10});
 const result=await Promise.allSettled([saveLocalModel(model(9),[],{limit:10}),saveLocalModel(model(10),[],{limit:10})]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.code,'MODEXA_QUOTA_REACHED');assert.equal((await listModels(owner)).length,10);
 console.log('PASS: paywall at 10; six prices selectable; instant pay feedback; no client amount; failure cannot unlock; confirmed entitlement refresh; atomic local last slot.');
}finally{w.close()}
