export function offer(plan: unknown,months: unknown,kind: unknown='subscription',credits: unknown=0){
  if(plan!=='pro'&&plan!=='business')throw Error('Invalid plan');
  const base=plan==='pro'?100:1000;
  if(kind==='topup'){
    if(months!==1||![base/2,base].includes(credits as number))throw Error('Invalid topup');
    const quantity=credits as number,amount=plan==='pro'?(quantity===50?3600:7000):(quantity===500?7600:15000);
    return {plan,months:1,kind,credits:quantity,amount,currency:'XOF',limit:quantity};
  }
  if(kind!=='subscription'||![1,3,12].includes(months as number))throw Error('Invalid offer');
  const duration=months as number,monthly=plan==='pro'?7000:15000;
  return {plan,months:duration,kind,credits:base*duration,amount:monthly*duration*(duration===3?90:duration===12?70:100)/100,currency:'XOF',limit:base*duration};
}
export function verifiedTransaction(transaction: any,payment: any){
  let expected;try{expected=offer(payment.plan,payment.months,payment.kind??'subscription',payment.credits??0)}catch{return false}
  return transaction.status==='approved'&&Number(transaction.amount)===expected.amount&&payment.amount===expected.amount&&(payment.credits===undefined||payment.credits===expected.credits)&&transaction.currency?.iso==='XOF'&&transaction.custom_metadata?.modexa_payment_id===payment.id&&Number.isSafeInteger(transaction.id)&&transaction.id>0&&(!payment.provider_transaction_id||Number(payment.provider_transaction_id)===transaction.id);
}
