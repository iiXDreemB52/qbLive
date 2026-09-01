const CACHE='sawalef-v15';
const CORE_ASSETS=[
  '/styles.css?v=13',
  '/lobby-v2.css?v=13',
  '/theme-blue.css?v=13',
  '/polish-v19.css?v=19',
  '/polish-v20.css?v=20',
  '/pre-auth.js?v=13',
  '/app.js?v=13',
  '/boot-guard-v12.js?v=13',
  '/pro-features.js?v=13',
  '/groups.js?v=13',
  '/auth-fix.js?v=13',
  '/group-create-fix.js?v=13',
  '/room-runtime-loader.js?v=13',
  '/polish-v19.js?v=19',
  '/polish-v20.js?v=20',
  '/manifest.webmanifest?v=13',
  '/icon.svg?v=20'
];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE_ASSETS)).then(()=>self.skipWaiting())));
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
