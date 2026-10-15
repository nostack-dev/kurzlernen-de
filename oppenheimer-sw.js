// Service worker for SpawnCity as an installed app (WebAPK / home screen): works OFFLINE and is still
// ALWAYS on the newest build when there is a network.
//  * The game page (one HTML file, all scripts inlined): network first, never from the HTTP cache —
//    online you always get the newest build; the fresh copy is stored, and only when the network is
//    unreachable the stored copy starts the game offline.
//  * build.json (the in-page version check): network only, never cached.
//  * Own static files (icons, manifest, music): served from the cache, refreshed in the background.
//  * Map data (vector tiles, aerial images, elevation): kept as you play (stale-while-revalidate,
//    bounded), so places you have been to also load offline.
// A new worker takes over at once; the page's own update check (build.json) reloads into a new build
// as soon as it is safe (never in the middle of a running game).
const APP="spawncity-app-v1",TILES="spawncity-tiles-v1",OLD_TILES=["rush-tiles-v1"],PAGE="./drone_simulator.html",TILE_LIMIT=4000;
const TILE_HOSTS=["tiles.openfreemap.org","services.arcgisonline.com","s3.amazonaws.com"];
const PRECACHE=["./drone_simulator.webmanifest","./sim/icons/spawncity-192.png","./sim/icons/spawncity-512.png","./sim/icons/spawncity-maskable-512.png","./sim/icons/apple-touch-icon.png"];
self.addEventListener("install",event=>{self.skipWaiting();event.waitUntil((async()=>{const c=await caches.open(APP);
  try{const r=await fetch(PAGE,{cache:"no-store",credentials:"same-origin"});if(r.ok)await c.put(PAGE,r);}catch{}
  await Promise.all(PRECACHE.map(u=>fetch(u,{cache:"no-cache"}).then(r=>r.ok?c.put(u,r):null).catch(()=>null)));})());});
self.addEventListener("activate",event=>event.waitUntil((async()=>{/* map data cached under the old name (RUSH) moves over, so offline places stay */for(const old of OLD_TILES){try{if(await caches.has(old)){const o=await caches.open(old),n=await caches.open(TILES);for(const k of await o.keys()){const r=await o.match(k);if(r)await n.put(k,r);}}}catch{}}for(const k of await caches.keys())if(k!==APP&&k!==TILES)await caches.delete(k);await self.clients.claim();})()));
async function pageFirst(request){const c=await caches.open(APP);
  try{const r=await fetch(request.url,{cache:"no-store",credentials:"same-origin"});if(r.ok){await c.put(PAGE,r.clone());}return r;}
  catch{const hit=await c.match(PAGE);if(hit)return hit;return new Response("<!doctype html><meta charset=utf-8><title>SpawnCity</title><body style='background:#111;color:#eee;font:16px system-ui;padding:24px'>Offline – SpawnCity braucht einmal einen Start mit Internet.",{headers:{"content-type":"text/html; charset=utf-8"}});}}
async function staleWhileRevalidate(request,cacheName,trim=0){const c=await caches.open(cacheName),hit=await c.match(request);
  const net=fetch(request).then(async r=>{if(r&&(r.ok||r.type==="opaque")){await c.put(request,r.clone());if(trim&&Math.random()<.02)trimCache(c,trim);}return r;}).catch(()=>null);
  if(hit){net.catch(()=>{});return hit;}const r=await net;return r||new Response("",{status:504,statusText:"offline"});}
async function trimCache(c,limit){try{const keys=await c.keys();for(let i=0;i<keys.length-limit;i++)await c.delete(keys[i]);}catch{}}
self.addEventListener("fetch",event=>{const req=event.request;if(req.method!=="GET")return;const url=new URL(req.url);
  if(url.origin===self.location.origin){
    if(url.pathname.endsWith("/build.json")){event.respondWith(fetch(req,{cache:"no-store"}).catch(()=>new Response("{}",{status:503,headers:{"content-type":"application/json"}})));return;}
    if(req.mode==="navigate"){event.respondWith(pageFirst(req));return;}
    if(/\.(png|webmanifest|m4a|mp3|woff2?)$/.test(url.pathname)){event.respondWith(staleWhileRevalidate(req,APP));return;}
    return;}
  if(TILE_HOSTS.includes(url.hostname)){event.respondWith(staleWhileRevalidate(req,TILES,TILE_LIMIT));return;}
});
self.addEventListener("message",event=>{if(event.data==="skip-waiting")self.skipWaiting();});
