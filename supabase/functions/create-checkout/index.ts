import { admin, fedapay, required, unwrapTransaction, retrieveTransaction, paymentUrl } from '../_shared/billing.ts';
import { offer, verifiedTransaction } from '../_shared/offers.ts';

Deno.serve(async req => {
  const origin=new URL(Deno.env.get('APP_ORIGIN')||'https://modexa-sigma.vercel.app').origin;
  const requestOrigin=req.headers.get('origin');
  // Exact app origins only. Authentication still determines the payment owner.
  const allowed=new Set([origin,'https://modexa-sigma.vercel.app','https://modexa-boutique.nasserpillar4.chatgpt.site','http://127.0.0.1:4173','http://localhost:4173']);
  const headers={'Access-Control-Allow-Origin':requestOrigin&&allowed.has(requestOrigin)?requestOrigin:origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Content-Type':'application/json','Cache-Control':'no-store'};
  const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(requestOrigin&&!allowed.has(requestOrigin))return response({error:'Origine refusée.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return response({error:'Method not allowed'},405);
  try{
    const db=admin(),token=req.headers.get('authorization')?.replace(/^Bearer /i,'');
    if(!token)return response({error:'Connectez-vous pour continuer.'},401);
    const {data:{user},error:authError}=await db.auth.getUser(token);
    if(authError||!user)return response({error:'Votre session a expiré. Reconnectez-vous.'},401);
    let body;try{body=await req.json()}catch{return response({error:'Demande invalide.'},400)}
    if(!body||typeof body!=='object')return response({error:'Demande invalide.'},400);
    if(body.action==='status'){
      let query=db.from('payments').select('*').eq('user_id',user.id);
      if(body.payment_id){if(!/^[0-9a-f-]{36}$/i.test(body.payment_id))return response({error:'Paiement invalide.'},400);query=query.eq('id',body.payment_id)}
      const {data:payment,error}=await query.order('created_at',{ascending:false}).limit(1).maybeSingle();
      if(error)throw error;
      if(!payment)return response({status:'none'});
      if(payment.paid_at)return response({status:'approved',payment_id:payment.id});
      if(!payment.provider_transaction_id)return response({status:payment.status,payment_id:payment.id});
      const tx=await retrieveTransaction(Number(payment.provider_transaction_id));
      if(tx.status==='approved'){
        if(!verifiedTransaction(tx,payment))return response({error:'Le paiement ne correspond pas à cette offre.'},409);
        const {error:confirmed}=await db.rpc('modexa_confirm_payment',{transaction_id:tx.id});if(confirmed)throw confirmed;
        return response({status:'approved',payment_id:payment.id});
      }
      if(['canceled','declined','expired','refunded'].includes(tx.status)){
        const {error:failed}=await db.from('payments').update({status:'failed'}).eq('id',payment.id).is('paid_at',null);if(failed)throw failed;
        return response({status:'failed',payment_id:payment.id});
      }
      return response({status:'pending',payment_id:payment.id});
    }
    let selected;try{selected=offer(body.plan,body.months,body.kind??'subscription',body.credits??0)}catch{return response({error:'Choisissez une offre et une durée valides.'},400)}
    required('FEDAPAY_SECRET_KEY');
    const {data:prepared,error}=await db.rpc('modexa_begin_checkout',{owner_id:user.id,offer_plan:selected.plan,offer_months:selected.months,offer_kind:selected.kind,offer_credits:selected.credits});
    if(error){
      const messages:Record<string,string>={MODEXA_RENEW_REQUIRED:'Renouvelez votre abonnement principal pour acheter une recharge.',MODEXA_CREDITS_REMAIN:'Utilisez vos places restantes avant d’acheter une recharge.',MODEXA_CHECKOUT_PENDING:'Une autre recharge est déjà en préparation. Terminez-la ou réessayez dans quelques minutes.'};
      if(messages[error.message])return response({error:messages[error.message]},409);throw error;
    }
    const payment=prepared.payment;
    if(payment.checkout_url&&new Date(payment.checkout_expires_at)>new Date())return response({url:paymentUrl(payment.checkout_url),payment_id:payment.id});
    let transaction;
    if(payment.provider_transaction_id){
      transaction=await retrieveTransaction(Number(payment.provider_transaction_id));
      if(transaction.status==='approved'){
        if(!verifiedTransaction(transaction,payment))return response({error:'Paiement non conforme.'},409);
        const {error:confirmed}=await db.rpc('modexa_confirm_payment',{transaction_id:transaction.id});if(confirmed)throw confirmed;
        return response({status:'approved',payment_id:payment.id});
      }
      if(transaction.status!=='pending'){
        const {error:failed}=await db.from('payments').update({status:'failed'}).eq('id',payment.id).is('paid_at',null);if(failed)throw failed;
        return response({error:'Ce paiement a été annulé. Vous pouvez réessayer.'},409);
      }
    }else{
      if(!prepared.created)return response({error:'La préparation est déjà en cours. Réessayez dans quelques instants.'},409);
      transaction=unwrapTransaction(await fedapay('/transactions',{
        description:`MODEXA ${selected.plan==='pro'?'Pro':'Business'} — ${selected.kind==='topup'?'Recharge '+selected.credits+' places · 30 jours':selected.months+' mois · '+selected.credits+' ajouts'}`,amount:selected.amount,currency:{iso:'XOF'},
        callback_url:`${origin}/?payment=${payment.id}`,custom_metadata:{modexa_payment_id:payment.id,plan:selected.plan,months:selected.months,kind:selected.kind,credits:selected.credits}
      }));
      if(!Number.isSafeInteger(transaction.id)||transaction.id<=0)throw Error('Invalid transaction');
      const {error:linked}=await db.from('payments').update({provider_transaction_id:transaction.id}).eq('id',payment.id).is('provider_transaction_id',null);if(linked)throw linked;
    }
    const link=await fedapay(`/transactions/${transaction.id}/token`,{}),url=paymentUrl(link.url);
    const {error:saved}=await db.from('payments').update({checkout_url:url,checkout_expires_at:new Date(Date.now()+600000).toISOString()}).eq('id',payment.id).is('paid_at',null);if(saved)throw saved;
    return response({url,payment_id:payment.id});
  }catch(error){console.error('Checkout failed',error instanceof Error?error.message:'Unknown error');return response({error:'Le service de paiement ne répond pas. Votre offre reste inchangée ; réessayez.'},503)}
});
