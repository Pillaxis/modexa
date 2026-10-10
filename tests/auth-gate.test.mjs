import {createAccountRecovery,validatePasswords} from '../dist/account-recovery.js';
import {createPhotoShare} from '../dist/photo-share.js';
import {createBillingUI} from '../dist/billing-ui.js';
import 'fake-indexeddb/auto';
import {JSDOM} from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as local from '../dist/local-store.js';
import * as authUtils from '../dist/auth-utils.js';

const catalog=fs.readFileSync(new URL('../dist/catalog.js',import.meta.url),'utf8').replaceAll('export ','');
const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/initialize\(\);\s*$/,'');
const windows=[];
function fixture(){
  const dom=new JSDOM('<div id="app"></div><dialog id="modal"></dialog><div id="toast"></div>',{url:'https://modexa.example/',runScripts:'outside-only'}),w=dom.window;
  windows.push(w);w.scrollTo=()=>{};w.URL.createObjectURL=()=>`blob:test`;w.URL.revokeObjectURL=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
  Object.assign(w,local,authUtils,{createBillingUI,createPhotoShare,createAccountRecovery,validatePasswords});w.migrateSession=async()=>{};
  w.eval(catalog+'\n'+app+'\nrequestSync=()=>{};loadAuthSDK=()=>new Promise(()=>{});globalThis.api={state,acceptUser,detail,prepareShare,initialize,connectCloud,clearUser,navigate,render,submitAuth,setClient(c){client=c}}');
  return {w,api:w.api,q:s=>w.document.querySelector(s)};
}
const owner='00000000-0000-4000-8000-000000000333',user={id:owner,email:'fixture@example.test'};
try{
  // New visitors must authenticate even when SDK/network never finishes loading.
  const first=fixture(),t=performance.now();await first.api.initialize();
  const firstMs=performance.now()-t;assert.ok(firstMs<1000);
  assert.ok(first.q('.auth-welcome'));assert.equal(first.q('#auth-form'),null);first.q('[data-action=welcome-login]').click();assert.equal(first.q('#auth-title').textContent,'Se connecter');assert.equal(first.q('[name=password_confirmation]'),null);assert.equal(first.q('.bottom-nav'),null);
  assert.equal(first.q('[name=prefix]').value,'+228');assert.equal(first.q('[data-action=close]'),null);
  for(const page of ['home','add','categories','gallery','profile']){first.api.navigate(page);assert.ok(first.q('#auth-form'));assert.equal(first.q('.bottom-nav'),null)}
  first.q('[data-action=welcome-back]').click();assert.ok(first.q('.auth-welcome'));first.q('[data-action=welcome-signup]').click();assert.equal(first.q('#auth-title').textContent,'Créer un compte');
  first.q('[data-auth=email]').click();assert.ok(first.q('[name=email]'));
  first.q('[name=email]').value='fixture@example.test';first.q('[name=password]').value='fixture-pass';first.q('[name=password_confirmation]').value='fixture-pass';first.api.render();
  assert.equal(first.q('[name=password]').value,'fixture-pass','background renders cannot erase typed credentials');
  let signupCalls=0;
  first.api.setClient({auth:{signUp:async()=>{signupCalls++;throw Error('Should not be called')}}});
  first.q('[name=password_confirmation]').value='different-pass';
  await first.api.submitAuth(first.q('#auth-form'));
  assert.equal(signupCalls,0);assert.match(first.q('#auth-error').textContent,/identiques/);
  first.q('[name=password_confirmation]').value='fixture-pass';
  first.api.setClient({auth:{signUp:async()=>({data:{},error:Error('Invalid login credentials')})}});
  await first.api.submitAuth(first.q('#auth-form'));
  assert.ok(first.q('#auth-error').textContent);assert.equal(first.api.state.user,null);assert.equal(first.q('.bottom-nav'),null);
  // Successful login enters directly. These accounts exist only in the test process.
  first.api.setClient({auth:{signUp:async()=>{await local.setMeta(local.AUTH_KEY,JSON.stringify({user,access_token:'fixture',refresh_token:'fixture'}));return {data:{session:{user},user},error:null}}}});
  await first.api.submitAuth(first.q('#auth-form'));
  assert.equal(first.q('#auth-form'),null);assert.ok(first.q('.bottom-nav'));assert.equal(first.api.state.page,'home');
  await local.saveLocalModel({id:'local-model',user_id:owner,name:'Robe bébé',category:'Robes',subcategory:'Robe bébé',images:[],created_at:new Date().toISOString()},[]);
  // Reopening restores the owned catalogue before any SDK load or server response.
  const returning=fixture(),r=performance.now();await returning.api.initialize();
  const returnMs=performance.now()-r;assert.ok(returnMs<1000);
  assert.equal(returning.q('#auth-form'),null);assert.ok(returning.q('.product'));assert.equal(returning.api.state.user.id,owner);
  let resolveCloud;returning.w.makeClient=()=>({auth:{onAuthStateChange(){},getSession:()=>new Promise(resolve=>{resolveCloud=resolve})}});
  const cloud=returning.api.connectCloud(Promise.resolve(null));await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(returning.q('.product'),'a stalled refresh must not hide local models');
  resolveCloud({data:{session:null},error:null});await cloud;
  assert.ok(returning.q('.auth-welcome'));assert.equal(returning.q('.product'),null,'revoked session returns to the gate');
  // A different account clears both the page and any open modal before IndexedDB resolves.
  const secondUser={id:'00000000-0000-4000-8000-000000000444',email:'second@example.test'};
  await local.setMeta(`draft:${owner}`,{draft:{category:'Robes',subcategory:'Robe bébé',reference:'A-private'},files:[]});
  await local.setMeta(`usage:${owner}`,{used:1});
  const isolation=fixture();await isolation.api.acceptUser(user,false);
  assert.equal(isolation.api.state.draft.reference,'A-private','current account draft must restore');
  assert.equal(isolation.api.state.billingKnown,true);
  isolation.api.detail('local-model');assert.equal(isolation.q('#modal').open,true);
  let resolvePhotos;
  isolation.api.state.models[0].images=[{path:owner+'/local-model/photo.jpg'}];
  isolation.w.getPhoto=()=>new Promise(resolve=>{resolvePhotos=resolve});
  const sharing=isolation.api.prepareShare(['local-model']);
  const switchAccount=isolation.api.acceptUser(secondUser,false);
  assert.equal(isolation.q('#modal').open,false);assert.equal(isolation.q('#modal').innerHTML,'');
  assert.equal(isolation.q('.product'),null,'old cards disappear synchronously');
  await switchAccount;resolvePhotos(new Blob(['private-photo'],{type:'image/jpeg'}));await sharing;
  assert.equal(isolation.q('#modal').innerHTML,'','late share cannot reopen previous account images');
  assert.equal(isolation.api.state.models.length,0);
  assert.equal(isolation.api.state.draft.reference,'','previous account draft is absent');
  assert.equal(isolation.api.state.billingKnown,false);
  let resolveInitial,authEvent;
  const racing=fixture();await racing.api.acceptUser(user,false);
  racing.w.makeClient=()=>({auth:{onAuthStateChange(fn){authEvent=fn},getSession:()=>new Promise(resolve=>{resolveInitial=resolve})}});
  const connecting=racing.api.connectCloud(Promise.resolve(null));await new Promise(r=>setTimeout(r,0));
  authEvent('SIGNED_IN',{user:secondUser});authEvent('SIGNED_OUT',null);
  resolveInitial({data:{session:{user}},error:null});await connecting;await new Promise(r=>setTimeout(r,0));
  assert.equal(racing.api.state.user,null,'old auth callbacks/bootstrap cannot resurrect a signed-out account');
  // Signing out leaves no open detail, image, navigation or personal data in the DOM.
  first.api.clearUser();assert.ok(first.q('.auth-welcome'));assert.equal(first.q('#modal').innerHTML,'');assert.equal(first.q('.bottom-nav'),null);
  await local.removeMeta(local.AUTH_KEY);
  const signedOut=fixture();await signedOut.api.initialize();assert.ok(signedOut.q('.auth-welcome'));assert.equal(signedOut.q('.product'),null);
  console.log(`PASS: mandatory auth gate; signup/login; rejection; saved session; slow SDK/cloud; invalidation; no signed-out data. Local startup: new ${firstMs.toFixed(0)} ms, returning ${returnMs.toFixed(0)} ms (JSDOM, no network).`);
}finally{for(const w of windows)w.close()}
