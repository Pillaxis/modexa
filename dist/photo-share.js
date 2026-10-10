export function createPhotoShare({doc,getAccountKey,loadPhoto,modal,toast}){
  const win=doc.defaultView,nav=win.navigator,$=s=>doc.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const maximum=20;
  let items=[],selected=new Set(),files=[],key=null,version=0,urls=[];
  function reset(){version++;for(const url of urls)win.URL.revokeObjectURL(url);urls=[];items=[];selected.clear();files=[];key=null}
  function active(ticket){return ticket===version&&key&&getAccountKey()===key}
  function render(){
    modal('Choisir les photos',`<p class="modal-copy">Sélectionnez jusqu’à ${maximum} photos. Elles seront transmises ensemble ; choisissez WhatsApp, puis le destinataire ou le groupe.</p><div class="share-photo-grid">${items.map((i,n)=>`<label class="share-photo"><input type="checkbox" data-share-photo="${n}" ${selected.has(n)?'checked':''}>${i.url?`<img src="${esc(i.url)}" alt="${esc(i.label)}">`:'<span class="share-placeholder">Photo '+(n+1)+'</span>'}<span>${esc(i.label)}</span></label>`).join('')}</div><p data-share-status role="status"></p><button class="primary" data-share-send disabled>Préparation des photos…</button><button class="secondary" data-share-retry hidden>Réessayer la préparation</button><button class="secondary" data-share-download hidden>Télécharger les photos sélectionnées</button>`);
  }
  async function prepare(){
    const ticket=++version;files=[];const send=$('[data-share-send]'),status=$('[data-share-status]');if(!send)return;
    send.disabled=true;send.hidden=false;send.textContent=selected.size?'Préparation des photos…':'Sélectionnez des photos';status.textContent='';
    $('[data-share-retry]').hidden=true;$('[data-share-download]').hidden=true;
    if(!selected.size)return;
    try{
      const chosen=[...selected].map(n=>items[n]);let cursor=0;const result=new Array(chosen.length);
      await Promise.all([0,1,2].map(async()=>{while(cursor<chosen.length){const n=cursor++,item=chosen[n];if(!active(ticket))return;const blob=await loadPhoto(item.path,key);if(!active(ticket))return;if(!blob)throw Error('Photo indisponible sur cet appareil. Connectez-vous à internet puis réessayez.');
        const ext=blob.type.split('/')[1]||'jpg';result[n]=new win.File([blob],`${item.filename}-${n+1}.${ext}`,{type:blob.type});
        if(!item.url){item.url=win.URL.createObjectURL(blob);urls.push(item.url);const index=items.indexOf(item),label=$(`[data-share-photo="${index}"]`)?.parentElement;if(label){const placeholder=label.querySelector('.share-placeholder');if(placeholder){const img=doc.createElement('img');img.src=item.url;img.alt=item.label;placeholder.replaceWith(img)}}}
      }}));
      if(!active(ticket))return;files=result;send.textContent=`Partager ${files.length} photo${files.length>1?'s':''} sur WhatsApp`;
      if(nav.share&&nav.canShare?.({files})){send.disabled=false;status.textContent=files.length+' photo(s) prête(s) pour un seul partage.'}
      else{send.hidden=true;$('[data-share-download]').hidden=false;status.textContent='Ce navigateur ne permet pas le partage de photos. Téléchargez les photos puis joignez-les ensemble dans WhatsApp.'}
    }catch(error){if(active(ticket)){status.textContent=error.message;$('[data-share-retry]').hidden=false;send.textContent='Photos indisponibles'}}
  }
  async function open(models){
    reset();key=getAccountKey();if(!key)return;
    items=models.flatMap(m=>(m.images||[]).map(i=>({path:i.path,url:i.url,label:[m.name,m.reference].filter(Boolean).join(' · '),filename:(m.reference||m.id).replace(/[^a-z0-9_-]/gi,'_')})));
    if(!items.length){toast('Ce modèle ne contient pas de photo.');return}
    selected=new Set(items.slice(0,maximum).map((_,n)=>n));render();await prepare();
  }
  function send(){
    if(!files.length||!key||getAccountKey()!==key)return;
    const ticket=version;
    // Must run synchronously inside the click: awaiting downloads here loses mobile user activation.
    try{Promise.resolve(nav.share({files:[...files],title:'MODEXA'})).then(()=>{if(active(ticket))$('#modal').close()}).catch(error=>{if(active(ticket)&&error.name!=='AbortError')$('[data-share-status]').textContent='Le partage n’a pas abouti. Touchez à nouveau le bouton pour réessayer.'})}
    catch{if(active(ticket))$('[data-share-status]').textContent='Le partage n’est pas disponible sur ce navigateur.'}
  }
  doc.addEventListener('change',event=>{const n=event.target.dataset?.sharePhoto;if(n===undefined)return;const index=Number(n);if(event.target.checked){if(selected.size>=maximum){event.target.checked=false;toast('Sélectionnez au maximum 20 photos par partage.');return}selected.add(index)}else selected.delete(index);prepare()});
  doc.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.hasAttribute('data-share-send'))send();if(b.hasAttribute('data-share-retry'))prepare();if(b.hasAttribute('data-share-download')&&key===getAccountKey())for(const file of files){const url=win.URL.createObjectURL(file),a=doc.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>win.URL.revokeObjectURL(url),30000)}});
  $('#modal').addEventListener('close',reset);
  return {open,reset};
}
