/** Complemento TypeScript del frontend heredado: estado del proxy sin exponer secretos. */
type ProxyStatus={ok:boolean;mode:string;writeEnabled:boolean;authMode:string;preloadedSources:number};
document.addEventListener('DOMContentLoaded',async()=>{
  const wrap=document.querySelector('.side-bottom');
  if(!wrap)return;
  const el=document.createElement('div');el.setAttribute('aria-live','polite');
  el.style.cssText='margin-top:9px;border-top:1px solid #38625a;padding-top:10px;line-height:1.7';
  try{
    const response=await fetch('/api/health',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw Error('Proxy no disponible');
    const s=await response.json() as ProxyStatus;
    el.textContent=`API local conectada · ${s.writeEnabled?'Escritura habilitada':'Solo lectura'} · ${s.authMode==='public'?'Acceso Public':'Bearer en servidor'}`;
  }catch{el.textContent='No se pudo verificar el proxy Node.js.';}
  wrap.append(el);
});
