from pathlib import Path

path=Path('sim/simulator.mjs')
text=path.read_text()
import_line='import {findSafeSpawn as searchSafeSpawn} from "./safe_spawn.mjs";\n'
matrix_import='import {COLLISION_TERRAIN,COLLISION_AIRFRAME,QUERY_RANGEFINDER,QUERY_CAMERA,QUERY_SPAWN,AIRFRAME_MASK,TERRAIN_MASK,BUILDING_MASK} from "./collision_filter_matrix.mjs";\n'

if matrix_import in text:
    required=[
        'shapeDef.filter={categoryBits:COLLISION_AIRFRAME,maskBits:AIRFRAME_MASK,groupIndex:0}',
        'maskBits:TERRAIN_MASK,friction:.78,restitution:.02',
        'groundShape.filter={categoryBits:COLLISION_TERRAIN,maskBits:TERRAIN_MASK,groupIndex:0}',
        'terrain=cast(QUERY_RANGEFINDER),obstacle=cast(QUERY_SPAWN)',
        'maskBits:BUILDING_MASK',
    ]
    missing=[marker for marker in required if marker not in text]
    if missing: raise SystemExit(f'partially patched simulator; missing {missing}')
    forbidden=['const COLLISION_TERRAIN = 1n;','const QUERY_CAMERA = 8n;','obstacle=cast(QUERY_CAMERA)','maskBits:COLLISION_AIRFRAME|QUERY_RANGEFINDER|QUERY_CAMERA']
    found=[marker for marker in forbidden if marker in text]
    if found: raise SystemExit(f'partially patched simulator; stale markers {found}')
    print('simulator collision matrix already patched and consistent')
    raise SystemExit(0)

def once(old,new,label):
    global text
    count=text.count(old)
    if count!=1: raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    text=text.replace(old,new,1)

def exactly(old,new,count,label):
    global text
    actual=text.count(old)
    if actual!=count: raise SystemExit(f'{label}: expected exactly {count} matches, found {actual}')
    text=text.replace(old,new)

once(import_line,import_line+matrix_import,'matrix import anchor')
once('const COLLISION_TERRAIN = 1n;\nconst COLLISION_AIRFRAME = 2n;\nconst QUERY_RANGEFINDER = 4n;\nconst QUERY_CAMERA = 8n;\n','', 'local collision constants')
once('shapeDef.filter={categoryBits:COLLISION_AIRFRAME,maskBits:COLLISION_TERRAIN,groupIndex:0}', 'shapeDef.filter={categoryBits:COLLISION_AIRFRAME,maskBits:AIRFRAME_MASK,groupIndex:0}', 'airframe filter')
once('createWorldTerrainCollision(b3,this.world,this.worldTerrainSnapshot,{categoryBits:COLLISION_TERRAIN,maskBits:COLLISION_AIRFRAME|QUERY_RANGEFINDER|QUERY_CAMERA,friction:.78,restitution:.02})', 'createWorldTerrainCollision(b3,this.world,this.worldTerrainSnapshot,{categoryBits:COLLISION_TERRAIN,maskBits:TERRAIN_MASK,friction:.78,restitution:.02})', 'terrain mesh filter')
once('groundShape.filter={categoryBits:COLLISION_TERRAIN,maskBits:COLLISION_AIRFRAME|QUERY_RANGEFINDER|QUERY_CAMERA,groupIndex:0}', 'groundShape.filter={categoryBits:COLLISION_TERRAIN,maskBits:TERRAIN_MASK,groupIndex:0}', 'flat terrain filter')
once('terrain=cast(QUERY_RANGEFINDER),obstacle=cast(QUERY_CAMERA)', 'terrain=cast(QUERY_RANGEFINDER),obstacle=cast(QUERY_SPAWN)', 'safe spawn query')
once('createWorldBuildingCollisionBodies(b3,this.world,this.worldBuildingCollisionSnapshot,{categoryBits:COLLISION_TERRAIN,maskBits:COLLISION_AIRFRAME|QUERY_RANGEFINDER|QUERY_CAMERA})', 'createWorldBuildingCollisionBodies(b3,this.world,this.worldBuildingCollisionSnapshot,{categoryBits:COLLISION_TERRAIN,maskBits:BUILDING_MASK})', 'building filter')

path.write_text(text)
print('patched simulator collision matrix')
