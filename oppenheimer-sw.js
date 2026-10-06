// Service worker for OPPENHEIMER as a home-screen app. It intentionally does
// not intercept or cache anything (current Chrome no longer needs a fetch
// handler to offer installation), so every deploy is picked up immediately
// and media/map requests are never proxied.
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
