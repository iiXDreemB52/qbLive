const CACHE='sawalef-v7';
const ASSETS=['/styles.css?v=7','/app.js?v=7','/audio-ultra.js?v=7','/groups.js?v=7','/livekit-sfu.js?v=7','/livekit-audio-fix.js?v=7','/livekit-admin-monitor.js?v=7','/manifest.webmanifest?v=7','/icon.svg?v=7'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/socket.io/')) return;
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return r}).catch(()=>caches.match(e.request)));
});
