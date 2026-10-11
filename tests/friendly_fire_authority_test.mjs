import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WORLD_OPTIONS,GAME_RULE_KEYS,worldRule,setHostRules,setWorldOption} from '../sim/world_options.mjs';
const source=readFileSync(new URL('../sim/vs_multiplayer.mjs',import.meta.url),'utf8');
const sync=readFileSync(new URL('../sim/game_rules_sync.mjs',import.meta.url),'utf8');
assert.ok(WORLD_OPTIONS.some(x=>x.key==='friendlyFire'&&x.def===false&&x.rule===true));
assert.ok(GAME_RULE_KEYS.includes('friendlyFire'));
setWorldOption('friendlyFire',true);
assert.equal(worldRule('friendlyFire'),true,'solo uses own choice');
globalThis.__arondightVsMultiplayer={connected:true,authority:'host',self:'guest'};
assert.equal(worldRule('friendlyFire'),false,'guest fails closed before host rule');
setHostRules({friendlyFire:false});
assert.equal(worldRule('friendlyFire'),false,'host disallows friendly fire');
setHostRules({friendlyFire:true});
assert.equal(worldRule('friendlyFire'),true,'host allows friendly fire');
setHostRules(null);
assert.equal(worldRule('friendlyFire'),false,'on stale host broadcast guest fails closed');
globalThis.__arondightVsMultiplayer={connected:true,authority:'host',self:'host'};
assert.equal(worldRule('friendlyFire'),true,'host uses own setting');
assert.match(source,/target!==shooter&&!globalThis\.__arondightWorldOptions\?\.rule\?\.\("friendlyFire"\)/,'damage gate must be inside authorityHit');
// The rules-vote module wraps the elected authority in host(). Verify BOTH
// the identity source and the packet-sender gate; never accept a foreign peer.
assert.match(sync,/const host=\(\)=>String\(mp\(\)\?\.authority\|\|\"\"\)/,'host identity must come from elected multiplayer authority');
assert.match(sync,/if\(from!==host\(\)\|\|amAuthority\(\)\|\|!pk\.rules\)return/,'reject impostor host rules before applying them');
assert.match(sync,/lastHostAt=performance\.now\(\);setHostRules\(pk\.rules\)/,'only authenticated host rules may be applied');
console.log('Friendly fire authority contract passed');
