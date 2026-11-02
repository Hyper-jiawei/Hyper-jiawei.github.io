const CACHE='hyper-publish-v1';
const SHELL=['./','./index.html','./style.css','./app.mjs','./core.mjs','./config.mjs','./icon.svg','./icon.png','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('hyper-publish-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  // Never intercept/cache GitHub API calls, photos, tokens or other site pages.
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith('/gallery/publish/'))return;
  const allowed=new Set(SHELL.map(p=>new URL(p,self.registration.scope).pathname));
  if(!allowed.has(url.pathname))return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request)));
});
