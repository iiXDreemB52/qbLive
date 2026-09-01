const CACHE='sawalef-v12';
const ASSETS=['/styles.css?v=12','/lobby-v2.css?v=12','/theme-blue.css?v=12','/advanced-call-v4.css?v=12','/room-experience-v10.css?v=12','/pre-auth.js?v=12','/app.js?v=12','/boot-guard-v12.js?v=12','/pro-features.js?v=12','/audio-ultra.js?v=12','/voice-v3.js?v=12','/livekit-audio-fix.js?v=12','/groups.js?v=12','/livekit-admin-monitor.js?v=12','/auth-fix.js?v=12','/group-create-fix.js?v=12','/advanced-call-v4.js?v=12','/compat-v10.js?v=12','/room-experience-v10.js?v=12','/manifest.webmanifest?v=12','/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/socket.io/')) return;
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return r}).catch(()=>caches.match(e.request)));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=event.notification?.data?.url||'/';
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const client of list){
      try{const u=new URL(client.url);if(u.origin===self.location.origin){client.navigate?.(target);return client.focus();}}catch{}
    }
    return clients.openWindow(target);
  }));
});
