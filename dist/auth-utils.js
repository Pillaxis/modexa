export function normalizePhone(raw,prefix='+228'){
  let value=String(raw||'').trim().replace(/[\s().-]/g,'');
  if(value.startsWith('00'))value='+'+value.slice(2);
  if(!value.startsWith('+')){
    const code=prefix.replace('+','');
    if(value.startsWith(code)&&value.length>10)value='+'+value;
    else value=prefix+value.replace(/^0+(?=\d)/,'');
  }
  if(!/^\+[1-9]\d{7,14}$/.test(value))throw Error('Saisissez un numéro valide, par exemple +228 90 12 34 56.');
  if(value.startsWith('+228')&&value.length!==12)throw Error('Un numéro togolais doit contenir 8 chiffres après +228.');
  return value;
}
export function authMessage(error){
  const code=error?.code||'',message=error?.message||'';
  if(code==='invalid_credentials'||/Invalid login/i.test(message))return 'Identifiant ou mot de passe incorrect. Vérifiez-les ou choisissez « Créer un compte ».';
  if(/already.*registered|already.*exists/i.test(message))return 'Ce compte existe déjà. Choisissez « Se connecter ».';
  if(/not confirmed/i.test(message))return 'Ce compte est encore en attente de validation. Contactez votre administrateur.';
  if(/rate.limit|too many/i.test(code+' '+message))return 'Trop de tentatives. Patientez quelques minutes puis réessayez.';
  if(/fetch|network|timeout|abort/i.test(message)||error?.name==='AbortError')return 'Connexion internet indisponible ou trop lente. Vérifiez votre réseau puis réessayez.';
  if(/weak_password|password.*least/i.test(code+' '+message))return 'Choisissez un mot de passe d’au moins 8 caractères.';
  return message||'Impossible de se connecter. Réessayez.';
}
