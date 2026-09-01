const CACHE='sawalef-v8';
const ASSETS=['/styles.css?v=8','/lobby-v2.css?v=8','/theme-blue.css?v=8','/pre-auth.js?v=8','/app.js?v=8','/audio-ultra.js?v=8','/voice-v3.js?v=8','/livekit-audio-fix.js?v=8','/groups.js?v=8','/livekit-admin-monitor.js?v=8','/auth-fix.js?v=8','/pro-features.js?v=8','/group-create-fix.js?v=8','/manifest.webmanifest?v=8','/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/socket.io/')) return;
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return r}).catch(()=>caches.match(e.request)));
});
