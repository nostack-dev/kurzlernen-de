// Finds the whole object for every city actor (person, car, bus, …).
// Some populations tag each body part / mesh with the actor id instead of
// the group, so "the tagged node" is often a single limb. The root is the
// highest ancestor below the scene whose tagged contents all share one id.

const idOf=n=>String(n?.userData?.worldPopulationId||n?.userData?.worldLifeId||"");
const kindOf=n=>String(n?.userData?.worldPopulationKind||n?.userData?.worldLifeKind||"");
function exclusive(node,id){for(const child of node.children){const cid=idOf(child);if(cid&&cid!==id)return false;}return true;}
export function actorRoot(node,scene){
  const id=idOf(node);let root=node;
  while(root.parent&&root.parent!==scene&&!root.parent.isScene){const p=root.parent,pid=idOf(p);if(pid&&pid!==id)break;if(!exclusive(p,id))break;if(p.children.length>24&&!pid)break;root=p;}
  return root;
}
export function actorRoots(scene){
  const roots=new Map();if(!scene)return roots;
  scene.traverse(node=>{const id=idOf(node),kind=kindOf(node);if(!id||!kind||roots.has(id))return;roots.set(id,{root:actorRoot(node,scene),kind:kind.replace(/^life-/,""),id});});
  return roots;
}
