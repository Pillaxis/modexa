import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createPhotoShare} from '../dist/photo-share.js';
import {nativeWhatsApp} from '../dist/native-whatsapp.js';

const w=new JSDOM('<dialog id="modal"></dialog>',{url:'https://modexa.test/'}).window;
const q=s=>w.document.querySelector(s);
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
w.HTMLDialogElement.prototype.close=function(){this.open=false};
w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
let account='A',error=null,pause=null;
const calls=[];
const plugin={
 async begin(){calls.push('begin');return {session:'test-session'}},
 async addPhoto(photo){calls.push(photo);if(pause)await pause},
 async share(){calls.push('share');if(error)throw Error(error)},
 async cancel(){calls.push('cancel')}
};
w.Capacitor={getPlatform:()=> 'android',Plugins:{ModexaWhatsApp:plugin}};
w.navigator.canShare=()=>false;
w.navigator.share=()=>assert.fail('Android must not open the system app chooser');
const api=createPhotoShare({doc:w.document,getAccountKey:()=>account,
 loadPhoto:async()=>new w.Blob(['photo'],{type:'image/jpeg'}),
 modal(_title,body){q('#modal').innerHTML=body;q('#modal').showModal()},toast(){}});
const models=[{id:'m',name:'Robe',images:[{path:'A/1'},{path:'A/2'}]}];
async function settled(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5))}assert.fail('Native sharing did not settle')}
try{
 await api.open(models);assert.equal(q('[data-share-send]').disabled,false);
 assert.match(q('.modal-copy').textContent,/WhatsApp s’ouvrira directement/);
 q('[data-share-send]').click();q('[data-share-send]').click();
 await settled(()=>calls.includes('cancel'));
 assert.equal(calls.filter(x=>x==='begin').length,1,'double click cannot prepare twice');
 const photos=calls.filter(x=>typeof x==='object');assert.equal(photos.length,2);
 assert.equal(photos[0].data,Buffer.from('photo').toString('base64'));assert.equal(photos[0].mime,'image/jpeg');
 assert.deepEqual(calls.filter(x=>typeof x==='string'),['begin','share','cancel']);
 await settled(()=>!q('#modal').open);

 calls.length=0;error='Installez WhatsApp ou WhatsApp Business';await api.open(models);q('[data-share-send]').click();
 await settled(()=>q('[data-share-status]').textContent.includes('Installez'));
 assert.equal(q('#modal').open,true);assert.equal(q('[data-share-send]').disabled,false,'error allows retry');
 assert.equal(calls.at(-1),'cancel','failed preparation cleans private copies');

 calls.length=0;error=null;let release;pause=new Promise(r=>{release=r});
 await api.open(models);q('[data-share-send]').click();await settled(()=>calls.some(x=>typeof x==='object'));
 account='B';api.reset();release();await settled(()=>calls.includes('cancel'));
 assert.equal(calls.includes('share'),false,'account changes cannot launch a stale share');
 assert.equal(calls.filter(x=>typeof x==='object').length,1,'remaining photos are not transferred');
 await assert.rejects(nativeWhatsApp(w)([{size:10485761}],()=>true),/Limite/);
 console.log('PASS: Android bypasses chooser; sequential photos; double-click guard; explicit native errors; cleanup; no account crossover.');
}finally{api.reset();w.close()}
