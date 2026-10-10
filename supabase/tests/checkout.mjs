import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {offer,verifiedTransaction} from '../functions/_shared/offers.ts';
const owner='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';
let payment,provider,requests,confirms,created,auth=true,signature=true;
function reset(){payment={id,user_id:owner,plan:'pro',months:1,amount:7000,status:'pending',provider_transaction_id:null};provider={id:42,status:'pending',amount:7000,currency_id:7,custom_metadata:{modexa_payment_id:id}};requests=[];confirms=0;created=true;auth=true;signature=true}
const db={auth:{getUser:async()=>({data:{user:auth?{id:owner}:null}})},
 from(){const filters=[];let patch;const q={select(){return q},update(value){patch=value;return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},order(){return q},limit(){return q},maybeSingle(){return q},then(resolve,reject){const matches=filters.every(([k,v])=>(payment[k]??null)===v);if(matches&&patch)Object.assign(payment,patch);return Promise.resolve({data:matches?{...payment}:null,error:null}).then(resolve,reject)}};return q},
 async rpc(name,args){if(name==='modexa_begin_checkout'){const chosen=offer(args.offer_plan,args.offer_months,args.offer_kind??'subscription',args.offer_credits??0);Object.assign(payment,{plan:chosen.plan,months:chosen.months,amount:chosen.amount,kind:chosen.kind,credits:chosen.credits});return {data:{payment:{...payment},created}}}if(name==='modexa_confirm_payment'){assert.equal(args.transaction_id,42);confirms++;payment.paid_at='2026-10-08';return {error:null}}throw Error(name)}
};
const fetchMock=async(url,options)=>{requests.push({url,body:options.body&&JSON.parse(options.body)});let result;
 if(url.endsWith('/currencies/7'))result={'v1/currency':{id:7,iso:'XOF'}};
 else if(url.endsWith('/token'))result={url:'https://checkout.fedapay.com/test'};
 else if(url.endsWith('/transactions')&&options.method==='POST'){Object.assign(provider,{amount:JSON.parse(options.body).amount});result={'v1/transaction':provider}}
 else result={'v1/transaction':provider};return new Response(JSON.stringify(result));};
const context=vm.createContext({Response,Request,URL,AbortSignal,console:{error(){}},fetch:fetchMock,createClient:()=>db,offer,verifiedTransaction,
 Deno:{env:{get:key=>({APP_ORIGIN:'https://modexa.test',FEDAPAY_ENVIRONMENT:'live'}[key]||'test-secret')},serve:fn=>{context.handler=fn}},
 Webhook:{constructEvent(body){if(!signature)throw Error('signature');return JSON.parse(body)}}});
async function evaluate(path){const source=(await readFile(new URL(path,import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');vm.runInContext(stripTypeScriptTypes(source),context)}
await evaluate('../functions/_shared/billing.ts');await evaluate('../functions/create-checkout/index.ts');const checkout=context.handler;
const request=(body,token=true)=>new Request('https://edge.test',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer test'}:{})},body:JSON.stringify(body)});
reset();
for(const origin of ['https://modexa.test','https://modexa-sigma.vercel.app','https://modexa-boutique.nasserpillar4.chatgpt.site','http://127.0.0.1:4173','http://localhost:4173']){
 const res=await checkout(new Request('https://edge.test',{method:'OPTIONS',headers:{origin}}));
 assert.equal(res.status,204);assert.equal(res.headers.get('access-control-allow-origin'),origin);
 const denied=await checkout(new Request('https://edge.test',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'}));
 assert.equal(denied.status,401,'allowed origin still requires an authenticated account');
}
assert.equal((await checkout(new Request('https://edge.test',{method:'OPTIONS',headers:{origin:'https://attacker.example'}}))).status,403);
reset();assert.equal((await checkout(request({},false))).status,401);assert.equal(requests.length,0);
auth=false;assert.equal((await checkout(request({plan:'pro',months:1}))).status,401);auth=true;
assert.equal((await checkout(request({plan:'business',months:2}))).status,400);assert.equal(requests.length,0);
let response=await checkout(request({plan:'business',months:3,amount:1}));assert.equal(response.status,200);assert.equal(requests[0].body.amount,40500);assert.equal(requests[0].body.currency.iso,'XOF');assert.equal(confirms,0);
created=false;const before=requests.length;assert.equal((await checkout(request({plan:'business',months:3}))).status,200);assert.equal(requests.length,before,'reuse valid checkout');
provider.status='approved';response=await checkout(request({action:'status',payment_id:id}));assert.equal((await response.json()).status,'approved');assert.equal(confirms,1);assert.ok(requests.some(r=>r.url.endsWith('/currencies/7')),'resolve provider currency id');
reset();payment.provider_transaction_id=42;provider.status='approved';provider.amount=1;assert.equal((await checkout(request({action:'status',payment_id:id}))).status,409);assert.equal(confirms,0);
payment.user_id='someone-else';response=await checkout(request({action:'status',payment_id:id}));assert.equal((await response.json()).status,'none');assert.equal(confirms,0);
reset();response=await checkout(request({kind:'topup',plan:'pro',months:1,credits:50,amount:1}));
assert.equal(response.status,200);assert.equal(requests[0].body.amount,3600);assert.equal(payment.credits,50);
provider.status='approved';response=await checkout(request({action:'status',payment_id:id}));assert.equal((await response.json()).status,'approved');assert.equal(confirms,1);
reset();assert.equal((await checkout(request({kind:'topup',plan:'pro',months:1,credits:500}))).status,400);assert.equal(requests.length,0);
reset();response=await checkout(request({kind:'topup',plan:'business',months:1,credits:1000}));assert.equal(response.status,200);assert.equal(requests[0].body.amount,15000);
await evaluate('../functions/fedapay-webhook/index.ts');const webhook=context.handler;
const event=()=>request({name:'transaction.approved',entity:{id:42}});
reset();signature=false;assert.equal((await webhook(event())).status,400);assert.equal(requests.length,0);
signature=true;provider.status='approved';assert.equal((await webhook(event())).status,200);assert.equal(payment.provider_transaction_id,42,'recover missing creation response');assert.equal(confirms,1);
assert.equal((await webhook(event())).status,200);assert.equal(confirms,1,'duplicate webhook is harmless');
reset();provider.status='approved';provider.amount=1;assert.equal((await webhook(event())).status,400);assert.equal(confirms,0);
reset();provider.status='approved';provider.custom_metadata.modexa_payment_id='unrelated';assert.equal((await webhook(event())).status,200);assert.equal(confirms,0);
console.log('PASS: authenticated checkout; server prices; cached link; ownership; provider currency resolution; status verification; signed-webhook gate; duplicate delivery; interrupted creation recovery.');
