// Service worker for RUSH as a home-screen app. Nothing is cached:
// page navigations are always fetched fresh from the network (no HTTP cache),
// so an installed app can never start on an old build. All other requests
// (scripts are inlined into the page anyway, media, map tiles) are untouched.
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("fetch",event=>{
  if(event.request.mode!=="navigate")return;
  event.respondWith(fetch(event.request.url,{cache:"no-store",credentials:"same-origin"}).catch(()=>fetch(event.request)));
});
