// Only offer installation when the browser supplies a real native prompt.
// A web page cannot install silently or manufacture this permission.
export function setupInstallation(win,doc){
  const banner=doc.getElementById('install-banner');if(!banner)return;
  const button=banner.querySelector('[data-install]');
  const display=win.matchMedia?.('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)');
  const installedKey='modexa-install-confirmed';
  const remembered=()=>{try{return win.localStorage.getItem(installedKey)==='1'}catch{return false}};
  let installed=remembered(),deferred=null,phase='idle';
  const standalone=()=>Boolean(display?.matches||win.navigator.standalone);
  function remember(value){installed=value;try{if(value)win.localStorage.setItem(installedKey,'1');else win.localStorage.removeItem(installedKey)}catch{}}
  function render(){
    if(standalone())remember(true);
    const hidden=installed||(!deferred&&phase==='idle');
    banner.hidden=hidden;doc.body.classList.toggle('has-install',!hidden);
    const legacy=doc.getElementById('install-dialog');if(legacy?.open)legacy.close();
    if(hidden)return;
    banner.querySelector('[data-install-title]').textContent=phase==='accepted'?'Installation en cours…':'Installer MODEXA';
    banner.querySelector('[data-install-status]').textContent=phase==='accepted'?'Votre téléphone termine l’installation.':phase==='prompting'?'Confirmez dans la fenêtre de votre navigateur.':'Votre boutique sur votre écran d’accueil.';
    button.hidden=phase==='accepted';button.disabled=phase==='prompting';
    button.textContent=phase==='prompting'?'Confirmation…':'Installer MODEXA';
  }
  async function install(){
    if(installed||standalone()||!deferred||phase!=='idle')return;
    const prompt=deferred;deferred=null;phase='prompting';render();
    try{
      // Keep prompt() in the original click: no timer, fetch or extra modal.
      const result=await prompt.prompt();const choice=result||await prompt.userChoice;
      phase=choice?.outcome==='accepted'?'accepted':'idle';
    }catch{phase='idle'}
    render();
  }
  win.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();if(standalone())return;
    remember(false);deferred=event;if(phase!=='prompting')phase='idle';render();
  });
  win.addEventListener('appinstalled',()=>{deferred=null;phase='idle';remember(true);render()});
  display?.addEventListener?.('change',render);
  win.addEventListener('pageshow',()=>{installed=installed||remembered();render()});
  win.addEventListener('storage',event=>{if(event.key===installedKey){installed=remembered();render()}});
  button.addEventListener('click',install);render();
}
if(typeof document!=='undefined')setupInstallation(window,document);
