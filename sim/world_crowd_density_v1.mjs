// Passers-by used to be extra people glued to the route walkers (re-attached to a new "base" person
// every scan, snapping in view). They are now ordinary persistent pedestrians: the population
// (world_procedural_population.mjs + pedestrian_agents.mjs) draws the same head-count — its draw
// slots include the former passers-by — every one a person with its own street and destination.
// This module keeps the old entry points so nothing that still asks for them breaks.
const MOBILE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i.test(globalThis.navigator?.userAgent||"");
const EXTRA_COUNT=MOBILE?28:40,NONE=Object.freeze([]);
let installed=false;
function publish(){const v=document.getElementById("viewport");if(!v)return;v.dataset.worldCrowdDensity="persistent-pedestrian-agents-v2";v.dataset.worldCrowdExtraCount=String(EXTRA_COUNT);v.dataset.worldCrowdNativePeople=v.dataset.worldPedestrianShown||"0";v.dataset.worldCrowdVisibleExtras="0";v.dataset.worldCrowdSpawnRule="out-of-view-arrivals-v2";}
export function installWorldCrowdDensityV1(){if(installed)return;installed=true;
  // vehicle impacts (people_impacts.mjs) ask every people source: this one has nobody of its own any more
  globalThis.__arondightCrowdExtras={people(){return NONE;},knockdown(){return null;}};
  if(typeof document!=="undefined"){publish();setInterval(publish,1000);}}
installWorldCrowdDensityV1();
