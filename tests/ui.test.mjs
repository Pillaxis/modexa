import {createPhotoShare} from '../dist/photo-share.js';
import {createBillingUI} from '../dist/billing-ui.js';
import 'fake-indexeddb/auto';
import {JSDOM} from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as local from '../dist/local-store.js';
import * as authUtils from '../dist/auth-utils.js';
const dom=new JSDOM('<div id="app"></div><dialog id="modal"></dialog><div id="toast"></div>',{url:'http://127.0.0.1:4173/',runScripts:'outside-only'}),w=dom.window;
w.scrollTo=()=>{};w.URL.createObjectURL=()=>`blob:test-${Math.random()}`;w.URL.revokeObjectURL=()=>{};
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
Object.assign(w,local,authUtils,{createBillingUI,createPhotoShare});
Object.defineProperty(w.navigator,'onLine',{configurable:true,value:false});
const css=w.document.createElement('style');css.textContent=fs.readFileSync(new URL('../dist/style.css',import.meta.url),'utf8');w.document.head.append(css);
const catalog=fs.readFileSync(new URL('../dist/catalog.js',import.meta.url),'utf8').replaceAll('export ','');
const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/initialize\(\);\s*$/,'');
w.eval(catalog+'\n'+app+'\nrequestSync=()=>{}; globalThis.api={state,navigate,auth,submitAuth,saveModel,editModelModal,saveEditedModel,deleteModel,prepareShare,detail,setClient(c){client=c}};');
const api=w.api,q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)],click=s=>q(s).click();
try{
 api.state.booting=false;api.state.billingKnown=true;
 assert.equal(api.state.models.length,0);api.navigate('home');assert.ok(q('#auth-form'));assert.equal(q('.bottom-nav'),null);assert.equal(q('[data-action=close]'),null);
 api.navigate('add');assert.equal(q('#add-form'),null);assert.ok(q('#auth-form'));
 api.state.user={id:'00000000-0000-4000-8000-000000000111'};
 api.navigate('home');assert.equal(qa('.product').length,0);assert.doesNotMatch(q('#app').textContent,/démonstration|R9538|Robe fleur/);
 api.navigate('categories');assert.equal(qa('[data-subcategory]').length,0);assert.equal(qa('.category-link').length,5);
 click('[data-category="Robes"]');assert.equal(api.state.page,'subcategories');assert.equal(qa('[data-subcategory]').length,5);
 click('[data-subcategory="Robe bébé"]');assert.equal(qa('.product').length,0);
 click('[data-page="subcategories"]');click('[data-page="categories"]');assert.equal(qa('[data-subcategory]').length,0);
 api.navigate('add');assert.deepEqual(qa('#add-form .form-grid [name]').map(n=>n.name),['category','subcategory','reference']);
 assert.equal(q('#add-form [name=category]').required,true);
 assert.equal(q('#add-form [name=subcategory]').required,true);
 assert.equal(q('#add-form [name=reference]').required,false);
 const choose=(selector,value)=>{q(selector).value=value;q(selector).dispatchEvent(new w.Event('change',{bubbles:true}));q(selector).dispatchEvent(new w.Event('input',{bubbles:true}))};
 choose('[name=category]','Robes');choose('[name=subcategory]','Robe bébé');choose('[name=category]','Jupes');assert.equal(q('[name=subcategory]').value,'');choose('[name=category]','');assert.equal(q('[name=subcategory]').disabled,true);
 assert.equal(w.getComputedStyle(q('header')).position,'sticky');
 const owner='00000000-0000-4000-8000-000000000111';api.state.user={id:owner};api.state.models=[];

 // Each mandatory field is validated before local save; reference stays optional.
 await api.saveModel(q('#add-form'));
 assert.match(q('#save-error').textContent,/photo/);assert.equal((await local.listModels(owner)).length,0);
 api.state.files.push({file:new Blob(['dummy-photo'],{type:'image/jpeg'}),preview:'blob:test-photo-1'});
 await api.saveModel(q('#add-form'));assert.match(q('#save-error').textContent,/catégorie/);
 choose('[name=category]','Robes');
 await api.saveModel(q('#add-form'));assert.match(q('#save-error').textContent,/sous-catégorie/);
 choose('[name=subcategory]','Robe bébé');
 api.state.billingKnown=false;
 const saveStart=performance.now();
 await api.saveModel(q('#add-form'));
 const saveMs=performance.now()-saveStart;assert.ok(saveMs<1000,`Offline local save took ${saveMs} ms`);
 console.log(`Offline save including photo: ${Math.round(saveMs)} ms (JSDOM/IndexedDB simulation).`);
 assert.deepEqual(qa('.section-heading h2').map(el=>el.textContent),['Ajoutés récemment','Mes catégories']);
 const saved=await local.listModels(owner);
 assert.equal(saved.length,1);
 assert.equal(saved[0].reference,null);
 assert.equal(saved[0].category,'Robes');
 assert.equal(saved[0].subcategory,'Robe bébé');
 assert.equal(saved[0].images.length,1);
 assert.equal(saved[0].sync_status,'pending');
 assert.equal(api.state.page,'home');
 assert.equal(q('#toast').textContent,'Modèle enregistré.');
 for(const status of ['pending','syncing','synced','conflict']){
   api.state.models[0].sync_status=status;api.state.syncing=status==='syncing';api.navigate('home');
   assert.equal(q('.sync-banner'),null);assert.equal(q('.model-sync'),null);
   assert.doesNotMatch(q('#app').textContent,/synchronis|envoi en cours|en attente/i);
 }
 api.state.models[0].sync_status='pending';

 // 5. Model detail view shows correct info and owner can edit model
 api.detail(saved[0].id);
 assert.match(q('#modal').textContent,/Robe bébé/);
 assert.ok(q('[data-action=edit-model]'));
 assert.ok(q('[data-action=delete-model]'));
 assert.equal(q('#modal').classList.contains('model-detail'),true);
 assert.equal(w.getComputedStyle(q('.detail-image img')).objectFit,'contain');
 assert.equal(w.getComputedStyle(q('.detail-image img')).height,'auto');
 assert.equal(q('#modal').querySelector('.detail-edit').textContent,'Modifier le modèle');

 // 6. Owner edits model (category, subcategory, reference)
 click('[data-action=edit-model]');
 assert.match(q('#modal').textContent,/Modifier le modèle/);
 assert.ok(q('#edit-form'));
 assert.equal(q('#modal').classList.contains('model-detail'),false);
 assert.equal(q('#edit-category').required,true);assert.equal(q('#edit-subcategory').required,true);
 assert.equal(q('#edit-reference').required,false);
 choose('#edit-category','Robes');
 await api.saveEditedModel(q('#edit-form'));assert.match(q('#edit-error').textContent,/sous-catégorie/);
 choose('#edit-subcategory','Robe moyenne');
 choose('#edit-reference','SOIR-001');
 await api.saveEditedModel(q('#edit-form'));
 const updated=await local.listModels(owner);
 assert.equal(updated.length,1);
 assert.equal(updated[0].category,'Robes');
 assert.equal(updated[0].subcategory,'Robe moyenne');
 assert.equal(updated[0].reference,'SOIR-001');
 assert.equal(api.state.models[0].subcategory,'Robe moyenne');
 assert.match(q('#toast').textContent,/mis à jour/);

 // Photo replacement is saved locally and a model cannot lose its last photo on save.
 api.detail(updated[0].id);click('[data-action=edit-model]');click('[data-edit-remove-old="0"]');
 await api.saveEditedModel(q('#edit-form'));assert.match(q('#edit-error').textContent,/photo/);
 assert.equal((await local.listModels(owner))[0].images.length,1);

 // 7. Owner deletes model
 api.detail(updated[0].id);
 click('[data-action=delete-model]');
 assert.match(q('#modal').textContent,/Supprimer définitivement/);
 await api.deleteModel(updated[0].id);
 assert.equal((await local.listModels(owner)).length,0);
 assert.equal(api.state.models.length,0);

 api.state.signup=true;api.auth();assert.equal(q('[name=full_name]'),null);assert.equal(q('[name=phone]').hasAttribute('pattern'),false);assert.equal(q('[name=password]').minLength,8);
 click('[data-action=show-password]');assert.equal(q('[name=password]').type,'text');
 let credentials;
 api.setClient({auth:{signUp:async input=>{credentials=input;return {data:{session:{},user:{id:owner}},error:null}},signInWithPassword:async input=>{credentials=input;return {data:{session:{},user:{id:owner}},error:null}}}});
 Object.defineProperty(w.navigator,'onLine',{configurable:true,value:true});
 q('[name=phone]').value='+228 90 12 34 56';q('[name=password]').value='random-example';await api.submitAuth(q('#auth-form'));assert.equal(credentials.phone,'+22890123456');assert.equal(q('#modal').open,false);
 api.state.signup=false;api.state.authMethod='email';api.auth();assert.equal(q('[name=password]').hasAttribute('minlength'),false);q('[name=email]').value='Example@Example.com';q('[name=password]').value='short';await api.submitAuth(q('#auth-form'));assert.equal(credentials.email,'example@example.com');assert.equal(credentials.password,'short');
 console.log('PASS: required photo/category/subcategory; optional reference; silent sync; full-photo styling; offline model edit/delete; progressive categories; signup/login.');
}finally{dom.window.close()}
