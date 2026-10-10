import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAccountRecovery,validatePasswords} from '../dist/account-recovery.js';

assert.throws(()=>validatePasswords('password1','password2'),/identiques/);
assert.throws(()=>validatePasswords('short','short'),/8 caractères/);
validatePasswords('password1','password1');
assert.throws(()=>validatePasswords('password1','password1 '),/identiques/);
const windows=[];
function fixture(url='https://modexa.test/'){
  const w=new JSDOM('<div id="app"></div>',{url}).window;windows.push(w);
  const calls=[],user={id:'owner'},q=selector=>w.document.querySelector(selector);
  let done=null,cancelled=false,otpError=null,sessionUser=user;
  const client={auth:{
    resetPasswordForEmail:async(...args)=>{calls.push(['email',...args]);return {}},
    signInWithOtp:async input=>{calls.push(['phone',input]);return {}},
    verifyOtp:async input=>{calls.push(['verify',input]);return otpError?{error:otpError}:{data:{session:{user}}}},
    getUser:async()=>({data:{user:sessionUser}}),
    updateUser:async input=>{calls.push(['update',input]);return {data:{user}}},
    signOut:async()=>{calls.push(['logout']);return {}}
  }};
  const recovery=createAccountRecovery({doc:w.document,getClient:()=>client,onStart(){},onComplete:async value=>{done=value},onCancel(){cancelled=true}});
  return {w,q,calls,recovery,get done(){return done},get cancelled(){return cancelled},set otpError(e){otpError=e},set sessionUser(v){sessionUser=v},submit:()=>recovery.submit(q('#recovery-form'))};
}
try{
  const email=fixture();email.recovery.open('email');email.q('[name=email]').value='User@Example.com';await email.submit();
  assert.deepEqual(email.calls[0],['email','user@example.com',{redirectTo:'https://modexa.test/'}]);
  assert.match(email.q('#app').textContent,/Si un compte correspond/);assert.equal(email.q('[name=password]'),null);
  email.recovery.handleAuth('PASSWORD_RECOVERY',{user:{id:'owner'}});
  email.q('[name=password]').value='new-password';email.q('[name=password_confirmation]').value='different';await email.submit();
  assert.match(email.q('#recovery-message').textContent,/identiques/);assert.equal(email.calls.filter(c=>c[0]==='update').length,0);
  email.q('[name=password_confirmation]').value='new-password';email.recovery.render();assert.equal(email.q('[name=password]').value,'new-password');await email.submit();
  assert.equal(email.done.id,'owner');assert.equal(email.recovery.active,false);
  assert.deepEqual(email.calls.at(-1),['update',{password:'new-password'}]);

  const phone=fixture();phone.recovery.open('phone');phone.q('[name=phone]').value='90 12 34 56';await phone.submit();
  assert.deepEqual(phone.calls[0],['phone',{phone:'+22890123456',options:{shouldCreateUser:false}}]);
  phone.q('[name=token]').value='123456';phone.otpError={code:'otp_expired'};await phone.submit();
  assert.match(phone.q('#recovery-message').textContent,/expiré/);assert.equal(phone.q('[name=password]'),null);
  phone.otpError=null;await phone.submit();assert.ok(phone.q('[name=password]'));
  phone.q('[name=password]').value='new-password';phone.q('[name=password_confirmation]').value='new-password';phone.sessionUser={id:'other'};await phone.submit();
  assert.equal(phone.calls.filter(c=>c[0]==='update').length,0,'a switched session cannot reset the wrong account');

  const expired=fixture('https://modexa.test/#error=access_denied&error_code=otp_expired');
  assert.equal(expired.recovery.arrive(),true);assert.match(expired.q('#recovery-message').textContent,/expiré/);assert.equal(expired.w.location.hash,'');
  const incoming=fixture('https://modexa.test/#type=recovery&access_token=fixture');incoming.recovery.arrive();
  assert.equal(incoming.q('[name=password]'),null,'URL flag alone cannot authorize a password update');
  incoming.recovery.handleAuth('INITIAL_SESSION',{user:{id:'old-session'}});incoming.recovery.ready();
  assert.equal(incoming.q('[name=password]'),null);
  console.log('PASS: exact password confirmation; email recovery; SMS without signup; expired codes; account changes; URL flag cannot authorize reset.');
}finally{windows.forEach(w=>w.close())}
