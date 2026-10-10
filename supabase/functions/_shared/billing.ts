import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
export function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}
export function admin() {
  return createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {auth:{persistSession:false,autoRefreshToken:false}});
}
export async function fedapay(path: string, body?: unknown) {
  const environment = required('FEDAPAY_ENVIRONMENT');
  if (!['sandbox','live'].includes(environment)) throw new Error('Invalid FedaPay environment');
  const base = environment === 'live' ? 'https://api.fedapay.com/v1' : 'https://sandbox-api.fedapay.com/v1';
  const result = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {Authorization:`Bearer ${required('FEDAPAY_SECRET_KEY')}`,'Content-Type':'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  if (!result.ok) throw new Error(`FedaPay request failed (${result.status})`);
  return await result.json();
}
export function unwrapTransaction(data: any) { return data['v1/transaction'] ?? data.transaction ?? data; }
export async function retrieveTransaction(id: number) {
  const transaction=unwrapTransaction(await fedapay(`/transactions/${id}`));
  if(transaction.id!==id)throw new Error('Unexpected transaction id');
  // Some API responses only include currency_id; resolve it before checking XOF.
  if(!transaction.currency?.iso&&Number.isSafeInteger(transaction.currency_id)&&transaction.currency_id>0){
    const data=await fedapay(`/currencies/${transaction.currency_id}`);
    const value=data['v1/currency']??data.currency??data;
    const currency=Array.isArray(value)?value.find(c=>c.id===transaction.currency_id):value;
    if(currency?.id===transaction.currency_id)transaction.currency=currency;
  }
  return transaction;
}
export function paymentUrl(value: string) {
  const url = new URL(value);
  if(url.protocol !== 'https:' || !(url.hostname === 'fedapay.com' || url.hostname.endsWith('.fedapay.com'))) throw new Error('Unexpected payment host');
  return url.href;
}
