import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id serial primary key,bucket_id text,name text); alter table storage.objects enable row level security;
grant usage on schema storage to authenticated; grant all on storage.objects to authenticated; grant usage on all sequences in schema storage to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;`);
await db.exec(await readFile(new URL('../migrations/202610030001_modexa.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../migrations/20261006151337_optional_model_fields.sql',import.meta.url),'utf8'));
const alice='00000000-0000-4000-8000-000000000001',bob='00000000-0000-4000-8000-000000000002';
await db.exec(`insert into auth.users values('${alice}'),('${bob}'); set role authenticated; set request.jwt.claim.sub='${alice}';`);
await db.query(`insert into models(user_id,name,reference,category,subcategory,images) values($1,'Robe moyenne','R9538','Robes','Robe moyenne',$2)`,[alice,JSON.stringify([{path:`${alice}/a/photo.jpg`}])]);
await db.query(`insert into storage.objects(bucket_id,name) values('model-images',$1)`,[`${alice}/a/photo.jpg`]);
assert.equal((await db.query('select * from models')).rows.length,1);
// Multiple models without references are valid and do not collide.
await db.query(`insert into models(user_id,name,reference,category,subcategory,images) values($1,'Robe bébé',null,'Robes','Robe bébé',$2)`,[alice,JSON.stringify([{path:`${alice}/b/photo.jpg`}])]);
await db.query(`insert into models(user_id,name,reference,category,subcategory,images) values($1,'Robe petite',null,'Robes','Robe petite',$2)`,[alice,JSON.stringify([{path:`${alice}/c/photo.jpg`}])]);
assert.equal((await db.query('select * from models where reference is null')).rows.length,2);
// Duplicate non-empty reference is rejected
await assert.rejects(db.query(`insert into models(user_id,name,reference,category,subcategory,images) values($1,'Robe dupe','r9538','Robes','Robe moyenne',$2)`,[alice,JSON.stringify([{path:`${alice}/d/photo.jpg`}])]),/unique constraint/);
// Empty models and photo-only models are permitted.
const empty=await db.query(`insert into models(user_id) values($1) returning *`,[alice]);
assert.equal(empty.rows[0].name,'Modèle sans catégorie');assert.deepEqual(empty.rows[0].images,[]);
assert.equal(empty.rows[0].category,null);assert.equal(empty.rows[0].subcategory,null);
await db.query(`insert into models(user_id,images) values($1,$2)`,[alice,JSON.stringify([{path:`${alice}/e/photo.jpg`}])]);
// Too many photos (>10) is rejected
await assert.rejects(db.query(`insert into models(user_id,name,category,subcategory,images) values($1,'Trop','Robes','Robe moyenne',$2)`,[alice,JSON.stringify(Array(11).fill({path:`${alice}/photo.jpg`}))]),/check constraint/);
// Non-array images is rejected
await assert.rejects(db.query(`insert into models(user_id,name,category,subcategory,images) values($1,'Bad','Robes','Robe moyenne',$2)`,[alice,'{}']),/check constraint/);
// Row level security blocks Bob
await assert.rejects(db.query(`insert into models(user_id,name,category,subcategory,images) values($1,'Bob','Robes','Robe moyenne',$2)`,[bob,JSON.stringify([{path:`${bob}/b/photo.jpg`}])]),/row-level security/);
await assert.rejects(db.query(`update models set images=$1`,[JSON.stringify([{path:`${bob}/b/photo.jpg`}])]),/check constraint/);
await assert.rejects(db.exec(`insert into subscriptions(user_id,status) values('${alice}','active')`),/permission denied/);
await assert.rejects(db.exec('select modexa_confirm_payment(123)'),/permission denied/);
await db.exec(`set request.jwt.claim.sub='${bob}'`);
assert.equal((await db.query('select * from models')).rows.length,0);
assert.equal((await db.query('select * from storage.objects')).rows.length,0);
await assert.rejects(db.query(`insert into storage.objects(bucket_id,name) values('model-images',$1)`,[`${alice}/attack.jpg`]),/row-level security/);
await db.exec(`reset role; insert into payments(user_id,provider_transaction_id) values('${alice}',123); select modexa_confirm_payment(123);`);
const expiry=async()=>(await db.query('select current_period_end from subscriptions where user_id=$1',[alice])).rows[0].current_period_end;
const first=await expiry(); await db.exec('select modexa_confirm_payment(123)');
assert.equal(new Date(first).getTime(),new Date(await expiry()).getTime());
await db.exec(`insert into payments(user_id,provider_transaction_id) values('${alice}',124); select modexa_confirm_payment(124)`);
assert.ok(new Date(await expiry())>new Date(first));
await db.exec(`set role authenticated; set request.jwt.claim.sub='${bob}'`);
assert.equal((await db.query('select * from subscriptions')).rows.length,0);
assert.equal((await db.query('select * from payments')).rows.length,0);
await db.exec('set role anon'); await assert.rejects(db.query('select * from models'),/permission denied/);
console.log('PASS: optional fields/photos; image limits; cross-account isolation; private storage; billing write denial; idempotent payment; renewal.');
await db.close();
