import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {offer,verifiedTransaction} from '../functions/_shared/offers.ts';
import {planPrice,entitlement} from '../../dist/plans.js';
const db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id serial primary key,bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;`);
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const alice='00000000-0000-4000-8000-000000000001',bob='00000000-0000-4000-8000-000000000002';
 await db.exec(`insert into auth.users values('${alice}'),('${bob}');set role authenticated;set request.jwt.claim.sub='${alice}'`);
 const add=n=>db.exec(`insert into models(user_id) select '${alice}' from generate_series(1,${n})`);
 await add(10);await assert.rejects(add(1),/MODEXA_QUOTA_REACHED/);
 await db.exec(`delete from models where id=(select id from models limit 1)`);await add(1);
 await assert.rejects(db.exec(`update models set user_id='${bob}'`),error=>error.code==='42501');
 await assert.rejects(db.exec(`select * from private.modexa_usage`),/permission denied/);
 await assert.rejects(db.exec(`select modexa_confirm_payment(1)`),/permission denied/);
 await assert.rejects(db.exec(`select modexa_begin_checkout('${alice}','pro',1)`),/permission denied/);
 const getState=async()=> (await db.query('select modexa_billing_state() state')).rows[0].state;
 assert.equal((await getState()).user_id,alice,'billing response carries the authenticated owner');
 assert.equal((await getState()).used,10);assert.equal(entitlement((await getState()).subscription).limit,10);
 await db.exec('reset role');
 const expected={pro:[7000,18900,58800],business:[15000,40500,126000]};
 for(const plan of ['pro','business'])for(const [i,months] of [1,3,12].entries()){
   const chosen=offer(plan,months);assert.equal(chosen.amount,expected[plan][i]);assert.equal(chosen.amount,planPrice(plan,months));
   const a=(await db.query('select modexa_begin_checkout($1,$2,$3) result',[alice,plan,months])).rows[0].result;
   const b=(await db.query('select modexa_begin_checkout($1,$2,$3) result',[alice,plan,months])).rows[0].result;
   assert.equal(a.payment.amount,chosen.amount);assert.equal(a.created,true);assert.equal(b.created,false);assert.equal(a.payment.id,b.payment.id);
   const tx={id:1,status:'approved',amount:chosen.amount,currency:{iso:'XOF'},custom_metadata:{modexa_payment_id:a.payment.id}};
   assert.equal(verifiedTransaction(tx,a.payment),true);
   for(const tamper of [{amount:1},{status:'pending'},{currency:{iso:'EUR'}},{custom_metadata:{modexa_payment_id:bob}}])assert.equal(verifiedTransaction({...tx,...tamper},a.payment),false);
 }
 assert.throws(()=>offer('pro',2));assert.throws(()=>offer('business','12'));assert.throws(()=>offer('admin',12));
 await assert.rejects(db.exec(`insert into payments(user_id,amount,plan,months) values('${alice}',1,'business',12)`),/check constraint/);

 let transaction=100;
 async function confirm(plan,months,kind='subscription',credits=0){
  const chosen=offer(plan,months,kind,credits),id=++transaction;
  const row=(await db.query('insert into payments(user_id,provider_transaction_id,plan,months,amount,kind,credits) values($1,$2,$3,$4,$5,$6,$7) returning id',[alice,id,plan,months,chosen.amount,kind,chosen.credits])).rows[0];
  await db.query('select modexa_confirm_payment($1)',[id]);return {id,payment:row.id};
 }
 const grantFor=async p=>(await db.query('select * from model_credits where payment_id=$1',[p.payment])).rows[0];
 const checkoutTopup=(plan,credits)=>db.query("select modexa_begin_checkout($1,$2,1,'topup',$3)",[alice,plan,credits]);
 const paid=await confirm('pro',3);let grant=await grantFor(paid);
 assert.equal(grant.total,300);assert.equal(grant.used,0);
 const firstEnd=(await db.query('select current_period_end from subscriptions where user_id=$1',[alice])).rows[0].current_period_end;
 assert.ok(Math.abs((firstEnd-Date.now())/86400000-90)<0.01);
 await db.query('select modexa_confirm_payment($1)',[paid.id]);assert.equal((await grantFor(paid)).total,300);
 await assert.rejects(checkoutTopup('pro',50),/MODEXA_CREDITS_REMAIN/);
 await db.exec('set role authenticated');await add(300);await assert.rejects(add(1),/MODEXA_QUOTA_REACHED/);
 await db.exec('delete from models where id=(select id from models limit 1)');await assert.rejects(add(1),/MODEXA_QUOTA_REACHED/);
 await db.exec("update models set name='Conservé'");
 await assert.rejects(db.exec('update model_credits set used=0'),/permission denied/);
 await db.exec('reset role');
 await assert.rejects(checkoutTopup('business',500),/MODEXA_RENEW_REQUIRED/);
 let top=(await checkoutTopup('pro',50)).rows[0].modexa_begin_checkout;
 assert.equal(top.payment.amount,3600);assert.equal(top.payment.credits,50);
 await assert.rejects(checkoutTopup('pro',100),/MODEXA_CHECKOUT_PENDING/);
 await db.query('update payments set provider_transaction_id=500 where id=$1',[top.payment.id]);await db.exec('select modexa_confirm_payment(500)');
 const recharge=(await db.query('select * from model_credits where payment_id=$1',[top.payment.id])).rows[0];
 assert.ok(Math.abs((recharge.expires_at-recharge.starts_at)/86400000-30)<0.01);
 assert.equal((await db.query('select current_period_end from subscriptions where user_id=$1',[alice])).rows[0].current_period_end.getTime(),firstEnd.getTime(),'topup never extends principal');
 await assert.rejects(checkoutTopup('pro',100),/MODEXA_CREDITS_REMAIN/);
 await db.exec('set role authenticated');await add(50);await assert.rejects(add(1),/MODEXA_QUOTA_REACHED/);
 await db.exec('reset role');await checkoutTopup('pro',100); // exhausted recharge can be replaced before its expiry
 const renewal=await confirm('pro',1);const renewalGrant=await grantFor(renewal);assert.equal(renewalGrant.total,100);
 assert.ok(Math.abs((renewalGrant.expires_at-firstEnd)/86400000-30)<0.01,'early renewal adds 30 days');
 assert.equal((await grantFor(paid)).expires_at.getTime(),grant.expires_at.getTime(),'old credits retain original expiry');
 // Remaining topup cannot authorize additions after principal expiry.
 const more=await confirm('pro',1,'topup',100);
 await db.exec("update subscriptions set current_period_end=now()-interval '1 day'");
 await db.exec('set role authenticated');await assert.rejects(add(1),/MODEXA_SUBSCRIPTION_EXPIRED/);
 const kept=(await db.query('select count(*) n from models')).rows[0].n;assert.ok(kept>300);
 await db.exec('reset role');await assert.rejects(checkoutTopup('pro',50),/MODEXA_RENEW_REQUIRED/);
 // Expiration loses unused places, never existing models. Renewal supplies fresh credits.
 await db.exec("update model_credits set starts_at=now()-interval '31 days',expires_at=now()-interval '1 day'");
 const renewed=await confirm('pro',1);assert.equal((await grantFor(renewed)).total,100);
 await db.exec('set role authenticated');await add(100);await assert.rejects(add(1),/MODEXA_QUOTA_REACHED/);
 await db.exec('reset role');const annual=await confirm('business',12);assert.equal((await grantFor(annual)).total,12000);
 const three=await confirm('business',3);assert.equal((await grantFor(three)).total,3000);
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${bob}'`);
 assert.equal((await getState()).quota.grants.length,0);assert.equal((await getState()).subscription,null);
 assert.equal((await db.query('select * from model_credits')).rows.length,0);
 await db.exec('set role anon');await assert.rejects(db.exec('select modexa_billing_state()'),/permission denied/);
 console.log('PASS: free 10 unchanged; Pro/Business durations and prices; consumable credits; deletion does not refund; recharge gating and replacement; 30-day expiry; principal required; early renewal; idempotency; old models retained; account isolation.');
}finally{await db.close()}
