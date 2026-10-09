// Service worker for RUSH as a home-screen app. Nothing is cached:
// page navigations are always fetched fresh from the network (no HTTP cache),
// so an installed app can never start on an old build. All other requests
// (scripts are inlined into the page anyway, media, map tiles) are untouched.
self.addEventListener("install",()=>self.skipWaiting());
// Older builds of this worker may have filled Cache Storage; drop all of it on every activation.
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).catch(()=>{}).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  // the version probe must never come from any cache
  if(url.origin===self.location.origin&&url.pathname.endsWith("/build.json")){event.respondWith(fetch(event.request,{cache:"no-store"}));return;}
  if(event.request.mode!=="navigate")return;
  event.respondWith(fetch(event.request.url,{cache:"no-store",credentials:"same-origin"}).catch(()=>fetch(event.request)));
});
