import { Webhook } from 'npm:fedapay@1.2.5';
import { admin, required, retrieveTransaction } from '../_shared/billing.ts';
import { verifiedTransaction } from '../_shared/offers.ts';

Deno.serve(async req=>{
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});
  if(Number(req.headers.get('content-length')||0)>1000000)return new Response('Payload too large',{status:413});
  let event;
  try {
    const body=await req.text();
    if(body.length>1000000)return new Response('Payload too large',{status:413});
    const signature=req.headers.get('x-fedapay-signature');
    event=Webhook.constructEvent(body,signature,required('FEDAPAY_WEBHOOK_SECRET'));
  }catch {return new Response('Invalid signature',{status:400})}
  if(event.name!=='transaction.approved')return new Response('Ignored',{status:200});
  try {
    const id=Number(event.entity?.id);
    if(!Number.isSafeInteger(id)||id<=0)return new Response('Invalid transaction',{status:400});
    const db=admin();
    const transaction=await retrieveTransaction(id);
    const paymentId=transaction.custom_metadata?.modexa_payment_id;
    if(typeof paymentId!=='string'||! /^[0-9a-f-]{36}$/i.test(paymentId))return new Response('Unrelated transaction',{status:200});
    const {data:payment,error}=await db.from('payments').select('*').eq('id',paymentId).maybeSingle();
    if(error)throw error;
    if(!payment)return new Response('Unrelated transaction',{status:200});
    if(payment.paid_at)return new Response('Already processed',{status:200});
    // Verify actual provider state: never activate from client redirect or webhook payload alone.
    if(!verifiedTransaction(transaction,payment))
      return new Response('Payment verification failed',{status:400});
    // Recover if creation was interrupted before persisting the provider id.
    if(!payment.provider_transaction_id){const {error:linked}=await db.from('payments').update({provider_transaction_id:id}).eq('id',payment.id).is('provider_transaction_id',null);if(linked)throw linked}
    const {error:confirmError}=await db.rpc('modexa_confirm_payment',{transaction_id:id});
    if(confirmError)throw confirmError;
    return new Response('Confirmed',{status:200});
  }catch(error){console.error('Payment confirmation failed',error instanceof Error?error.message:'Unknown error');return new Response('Retry later',{status:503})}
});
