import {PLANS,DURATIONS,TOPUPS,discount,planPrice,planCredits,money,entitlement,occupied,available,validGrants} from './plans.js';
import {getMeta,setMeta,removeMeta,cacheBilling} from './local-store.js';
export function createBillingUI({state,getClient,modal,toast,render,requestSync,navigate,doc}){
  const win=doc.defaultView,$=s=>doc.querySelector(s);
  let generation=0;const requests=new Set();
  const guard=()=>{const owner=state.user?.id,version=generation;return ()=>Boolean(owner)&&state.user?.id===owner&&version===generation};
  function reset(){generation++;clearTimeout(pollTimer);for(const c of requests)c.abort();requests.clear();busy=false;checking=false;refreshing=null;choice='pro';months=1;kind='subscription';topup=50}
  let kind='subscription',topup=50;
  let choice='pro',months=1,busy=false,refreshing=null,checking=false,pollTimer;
  let returned=new URLSearchParams(win.location.search).get('payment');
  const current=()=>entitlement(state.subscription);
  const used=()=>occupied(state.models,state.usage,state.pendingDeletes);
  const remaining=()=>available(state.models,state.usage,state.pendingDeletes,state.subscription);
  const canAdd=()=>remaining()>0;
  const topupAllowed=()=>current().active&&remaining()===0&&!state.models.some(m=>m.dirty==='create');
  const price=()=>kind==='topup'?TOPUPS[current().plan]?.find(p=>p.credits===topup)?.amount:planPrice(choice,months);
  const date=value=>new Date(value).toLocaleDateString('fr-FR');
  const status=()=>current().plan==='free'?`Gratuit · ${used()} / 10 modèles`:current().expired?'Abonnement expiré · modèles conservés':`${current().name} · ${remaining().toLocaleString('fr-FR')} ajouts restants · jusqu’au ${date(current().end)}`;
  function body(limited){
    const e=current(),recharge=kind==='topup',eligible=topupAllowed();
    const grants=validGrants(state.usage).filter(g=>g.total>g.used);
    const notices=`<p class="billing-current">${status()}</p>${limited?'<p class="quota-note">Vos places d’ajout sont épuisées ou expirées. Vos modèles restent consultables et partageables.</p>':''}`;
    const tabs=e.plan!=='free'?`<div class="billing-durations" role="group" aria-label="Type d’achat"><button data-billing-kind="subscription" aria-pressed="${!recharge}">Abonnement / renouvellement</button><button data-billing-kind="topup" aria-pressed="${recharge}" ${!eligible?'disabled':''}>Places supplémentaires</button></div>${!eligible&&e.active?'<p class="hint">Les recharges deviennent disponibles quand toutes vos places sont utilisées et vos derniers ajouts enregistrés dans votre compte.</p>':''}`:'';
    const offers=recharge?`<p class="muted">Recharge ${e.name} · utilisable pendant 30 jours après paiement, avec un abonnement principal actif.</p><div class="billing-plans">${TOPUPS[e.plan].map(p=>`<button data-billing-topup="${p.credits}" class="billing-plan" aria-pressed="${topup===p.credits}"><strong>${p.credits.toLocaleString('fr-FR')} nouveaux ajouts</strong><span class="billing-total">${money(p.amount)}</span><span>Validité : 30 jours</span></button>`).join('')}</div><p class="hint">La recharge ne prolonge pas votre abonnement. Une nouvelle recharge est possible seulement lorsque toutes les places disponibles sont utilisées.</p>`:
      `<p class="muted">Gratuit : 10 modèles dans votre catalogue. Les offres payantes donnent de nouveaux ajouts, utilisables avant leur expiration.</p><div class="billing-durations" role="group" aria-label="Durée de l’abonnement">${DURATIONS.map(n=>`<button data-billing-months="${n}" aria-pressed="${n===months}"><strong>${n} mois</strong><span>${n*30} jours${discount(n)?' · −'+discount(n)+' %':''}</span></button>`).join('')}</div><div class="billing-plans">${['pro','business'].map(p=>`<button data-billing-plan="${p}" aria-pressed="${p===choice}" class="billing-plan"><span class="billing-plan-name">MODEXA ${PLANS[p].name}</span><strong>${planCredits(p,months).toLocaleString('fr-FR')} nouveaux ajouts</strong><span class="billing-monthly">${money(PLANS[p].monthly)} / mois</span><span class="billing-total">${money(planPrice(p,months))} <small>pour ${months} mois</small></span>${months>1?`<span class="billing-saving">Économisez ${money(PLANS[p].monthly*months-planPrice(p,months))}</span>`:''}</button>`).join('')}</div><p class="hint">Le quota est disponible dès le paiement. En renouvelant avant l’expiration, la durée achetée s’ajoute au temps restant. Les anciennes places gardent leur propre date d’expiration.</p>`;
    return notices+tabs+offers+`<div class="billing-summary"><span>À payer aujourd’hui</span><strong>${money(price())}</strong><p>${recharge?topup+' places supplémentaires pour '+e.name:months+' mois de MODEXA '+PLANS[choice].name}</p></div><p class="hint">Les places inutilisées expirent. Vos modèles enregistrés restent accessibles. Supprimer un modèle payé ne restitue pas l’ajout consommé.</p>${grants.length?`<details class="credit-dates"><summary>Validité de mes places</summary>${grants.map(g=>`<p>${g.kind==='topup'?'Recharge':'Abonnement'} : ${(g.total-g.used).toLocaleString('fr-FR')} places · expiration le ${date(g.expires_at)}</p>`).join('')}</details>`:''}<p class="hint">Paiement sécurisé FedaPay · Aucun prélèvement automatique.</p><p id="checkout-error" class="inline-error" role="alert"></p><p id="checkout-status" class="hint" role="status"></p><button data-billing-pay class="primary billing-pay">Payer ${money(price())}</button><button data-billing-check class="text-button billing-check">J’ai déjà payé · Vérifier mon paiement</button>`;
  }
  let limited=false;
  function show(limit=false){if(!state.user)return;limited=limit;if(current().plan==='business')choice='business';kind=limit&&topupAllowed()?'topup':'subscription';topup=TOPUPS[current().plan]?.[0].credits||50;paint();refresh().catch(()=>{})}
  function paint(){modal('Choisissez votre offre',body(limited));$('#modal').classList.add('billing-modal')}
  async function refresh(force=false){
    const active=guard();
    if(refreshing){if(!force)return refreshing;await refreshing.catch(()=>{})}if(!active())return;
    const client=getClient(),owner=state.user?.id;if(!client||!owner||!win.navigator.onLine)return;
    const task=(async()=>{
      const {data,error}=await client.rpc('modexa_billing_state');if(error)throw error;
      if(!active())return;if(data?.user_id!==owner)throw Error('La session a changé. Réessayez.');
      const before=remaining(),wasEligible=topupAllowed();const cached=await cacheBilling(owner,data);if(!active())return;state.subscription=cached.subscription;state.usage=cached;state.billingKnown=true;
      if(!active())return;
      if($('.billing-current')){if(!busy&&(before!==remaining()||wasEligible!==topupAllowed())){if(kind==='topup'&&!topupAllowed())kind='subscription';paint()}else $('.billing-current').textContent=status()}render();
      return data;
    })();refreshing=task;
    try{return await task}finally{if(refreshing===task)refreshing=null}
  }
  async function ensureCanAdd(){
    // Saving uses cached paid rights (or the free limit), without waiting for a
    // connection. PostgreSQL remains authoritative across devices.
    if(!state.billingKnown)refresh().catch(()=>{});
    if(!canAdd()){show(true);return false}return true;
  }
  async function call(body){
    const controller=new AbortController();requests.add(controller);let timer;
    try{
      const {data,error}=await Promise.race([
        getClient().functions.invoke('create-checkout',{body,signal:controller.signal}),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Le paiement prend trop de temps. Vérifiez votre paiement ou réessayez dans un instant.'))},25000)})
      ]);
      if(error){let message;try{message=(await error.context.json()).error}catch{}throw Error(message||'Impossible d’ouvrir FedaPay. Vérifiez votre connexion, puis réessayez.')}
      if(data?.error)throw Error(data.error);return data;
    }finally{clearTimeout(timer);requests.delete(controller)}
  }
  async function pay(){
    if(busy||!state.user||!getClient())return;const active=guard();if(!win.navigator.onLine){$('#checkout-error').textContent='Connectez-vous à internet pour payer.';return}
    busy=true;const owner=state.user.id,button=$('[data-billing-pay]');button.disabled=true;button.textContent='Ouverture du paiement…';$('#checkout-error').textContent='';
    doc.querySelectorAll('[data-billing-plan],[data-billing-months],[data-billing-kind],[data-billing-topup]').forEach(b=>b.disabled=true);
    const slow=setTimeout(()=>{if(active()&&$('#checkout-status'))$('#checkout-status').textContent='FedaPay prépare votre paiement. Votre demande est en cours.'},2500);
    try{
      if(kind==='topup'&&!topupAllowed())throw Error('Utilisez vos places restantes ou renouvelez votre abonnement.');
      const data=await call(kind==='topup'?{kind,plan:current().plan,months:1,credits:topup}:{kind,plan:choice,months});if(!active())return;
      if(data.status==='approved'){await refresh(true);if(!active())return;$('#modal').close();toast('Paiement confirmé. Votre offre est active.');requestSync(true);return}
      const url=new URL(data.url);if(url.protocol!=='https:'||!(url.hostname==='fedapay.com'||url.hostname.endsWith('.fedapay.com')))throw Error('Lien de paiement invalide.');
      await setMeta(`pending-payment:${owner}`,data.payment_id);if(!active())return;win.location.assign(url.href);
    }catch(error){if(active()&&$('#checkout-error'))$('#checkout-error').textContent=error.message}
    finally{clearTimeout(slow);if(active()){busy=false;if(button.isConnected){button.disabled=false;button.textContent='Payer '+money(price());doc.querySelectorAll('[data-billing-plan],[data-billing-months],[data-billing-kind],[data-billing-topup]').forEach(b=>b.disabled=false);const rechargeButton=$('[data-billing-kind=topup]');if(rechargeButton)rechargeButton.disabled=!topupAllowed()}}}
  }
  async function checkPayment(manual=false,attempt=0){
    const owner=state.user?.id,active=guard();if(!owner||checking||!getClient()||!win.navigator.onLine)return;
    const pending=returned&&returned!=='return'?returned:await getMeta(`pending-payment:${owner}`);
    if(!active()||(!pending&&!manual))return;
    checking=true;const el=$('#checkout-status');if(el)el.textContent='Vérification du paiement…';
    try{
      const result=await call({action:'status',...(pending?{payment_id:pending}:{})});if(!active())return;
      if(result.status==='approved'){
        await refresh(true);if(!active())return;
        returned=null;await removeMeta(`pending-payment:${owner}`);if(!active())return;clearTimeout(pollTimer);
        $('#modal').close();toast('Paiement confirmé : '+status());requestSync(true);
      }else if(result.status==='failed'||result.status==='none'){
        returned=null;await removeMeta(`pending-payment:${owner}`);if(!active())return;
        if(el)el.textContent=result.status==='failed'?'Paiement non validé. Vous pouvez réessayer.':'Aucun paiement à confirmer.';
        else if(manual)toast('Aucun paiement validé pour le moment.');
      }else{
        if(el)el.textContent='Paiement en attente de confirmation FedaPay.';
        if(attempt<7)pollTimer=setTimeout(()=>checkPayment(false,attempt+1),3000);
      }
    }catch(error){if(active()){if(el)el.textContent=error.message;else if(manual)toast(error.message)}}finally{if(active())checking=false}
  }
  doc.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-billing-pay')){pay();return}
    if(button.hasAttribute('data-billing-check')){checkPayment(true);return}
    if(busy)return;
    if(button.dataset.billingKind){if(button.dataset.billingKind==='topup'&&!topupAllowed())return;kind=button.dataset.billingKind;topup=TOPUPS[current().plan]?.[0].credits||50;paint()}
    if(button.dataset.billingTopup){topup=Number(button.dataset.billingTopup);paint()}
    if(button.dataset.billingPlan){choice=button.dataset.billingPlan;paint()}
    if(button.dataset.billingMonths){months=Number(button.dataset.billingMonths);paint()}
  });
  win.addEventListener('pageshow',()=>checkPayment());
  doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible')checkPayment()});
  return {reset,show,refresh,ensureCanAdd,canAdd,current,used,status,remaining,topupAllowed,checkPayment};
}
