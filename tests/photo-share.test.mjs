import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createPhotoShare} from '../dist/photo-share.js';
const w=new JSDOM('<dialog id="modal"></dialog>',{url:'https://modexa.test/'}).window,q=s=>w.document.querySelector(s);
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
let account='A:1',calls=[],load=async()=>new w.Blob(['image-bytes'],{type:'image/jpeg'});
w.navigator.canShare=({files})=>files.length>0;w.navigator.share=data=>{calls.push(data);return Promise.resolve()};
const api=createPhotoShare({doc:w.document,getAccountKey:()=>account,loadPhoto:(...args)=>load(...args),modal(title,body){q('#modal').innerHTML=body;q('#modal').showModal()},toast(){}});
const models=[{id:'m',name:'Robe',reference:'R123',images:[{path:'A/m/1'},{path:'A/m/2'},{path:'A/m/3'}]}];
try{
 await api.open(models);assert.equal(q('[data-share-send]').disabled,false);
 const option=q('[data-share-photo="1"]');option.checked=false;option.dispatchEvent(new w.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,0));
 q('[data-share-send]').click();assert.equal(calls.length,1,'one click invokes share synchronously');assert.equal(calls[0].files.length,2,'all selected photos in one native share');assert.match(calls[0].files[0].name,/R123/);
 await new Promise(r=>setTimeout(r,0));assert.equal(q('#modal').open,false);
 let finish;load=()=>new Promise(r=>{finish=r});const pending=api.open([{...models[0],images:[models[0].images[0]]}]);account='B:2';api.reset();finish(new w.Blob(['private'],{type:'image/jpeg'}));await pending;q('[data-share-send]').click();assert.equal(calls.length,1,'late photos cannot be shared after changing account');
 account='A:3';load=async()=>new w.Blob(['image'],{type:'image/jpeg'});w.navigator.canShare=()=>false;await api.open(models);assert.equal(q('[data-share-send]').hidden,true);assert.equal(q('[data-share-download]').hidden,false);
 console.log('PASS: individual photo selection; single batch share; synchronous mobile activation; no account crossover; honest unsupported-browser fallback.');
}finally{api.reset();w.close()}
