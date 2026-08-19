#!/usr/bin/env bash
set -euxo pipefail

# Running workflow is already loaded. Normalize the working tree immediately.
git show ce5904ebf03a9e50df41e4e71a2f376ae1681e90:.github/workflows/deploy.yml > .github/workflows/deploy.yml
git show ce5904ebf03a9e50df41e4e71a2f376ae1681e90:.github/workflows/s31-hil.yml > .github/workflows/s31-hil.yml
rm -f tools/finalize_product_once.sh
find .github/workflows -maxdepth 1 -type f ! -name deploy.yml ! -name s31-hil.yml -delete
test "$(find .github/workflows -maxdepth 1 -type f -printf '%f\n' | sort | tr '\n' ' ')" = "deploy.yml s31-hil.yml "

# Apply the reviewed source patch kept off main.
git fetch origin finalize-flight-photoreal:refs/remotes/origin/finalize-flight-photoreal
git show origin/finalize-flight-photoreal:.github/workflows/finalize-flight-photoreal.yml >/tmp/finalize-source.yml
python3 - <<'PY'
from pathlib import Path
lines=Path('/tmp/finalize-source.yml').read_text().splitlines()
target='- name: Apply flight handoff, FPV optical stabilization, and lazy photoreal wiring'
start=next(i for i,x in enumerate(lines) if x.strip()==target)
run=next(i for i in range(start+1,len(lines)) if lines[i].strip()=='run: |')
out=[]
for line in lines[run+1:]:
    if line.startswith('      - name:'): break
    out.append(line[10:] if line.startswith('          ') else line)
script='\n'.join(out)+'\n'
script=script.replace('const MODE_STORAGE="arondight45WorldMode";','const MODE_STORAGE="arondight45WorldModeV2";')
Path('/tmp/apply-reviewed.sh').write_text(script)
PY
bash -euxo pipefail /tmp/apply-reviewed.sh

# Final tuning: keep full authority, smooth only stick/height release.
python3 - <<'PY'
from pathlib import Path
p=Path('esp32/Arondight45_StateControl.hpp')
s=p.read_text().replace('kVerticalJerkLimitMps3 = 400.0f','kVerticalJerkLimitMps3 = 1200.0f')
old='''        const float target_horizontal_speed = std::sqrt(commanded_forward_mps_ * commanded_forward_mps_ +
                                                        commanded_right_mps_ * commanded_right_mps_);
        // The I term is drag compensation for a non-zero cruise target. It must
        // never become stored propulsion after the pilot releases translation.
        // Neutral means an immediate zero-velocity target, so clear the cruise
        // compensation before computing the braking acceleration. The P/D path
        // then commands counter-tilt immediately, still under the same 7.5 m/s²
        // and 40° physical envelopes.
        if (target_horizontal_speed <= kHorizontalIntegralNeutralTargetMps) {'''
new='''        const float target_horizontal_speed = std::sqrt(commanded_forward_mps_ * commanded_forward_mps_ +
                                                        commanded_right_mps_ * commanded_right_mps_);
        const float pilot_horizontal_speed = std::sqrt(intent.forward_mps * intent.forward_mps +
                                                       intent.right_mps * intent.right_mps);
        // Pilot-neutral clears stored cruise compensation immediately. Only the
        // requested velocity target ramps down, eliminating the reverse kick.
        if (pilot_horizontal_speed <= kHorizontalIntegralNeutralTargetMps) {'''
if s.count(old)!=1: raise SystemExit(f'neutral integral block mismatch: {s.count(old)}')
s=s.replace(old,new,1)
old_i='if (target_horizontal_speed > kHorizontalIntegralNeutralTargetMps) {'
if s.count(old_i)!=1: raise SystemExit(f'integrator gate mismatch: {s.count(old_i)}')
s=s.replace(old_i,'if (pilot_horizontal_speed > kHorizontalIntegralNeutralTargetMps) {',1)
p.write_text(s)

p=Path('tests/architecture_invariants.mjs')
p.write_text(p.read_text().replace('kVerticalJerkLimitMps3 = 400.0f','kVerticalJerkLimitMps3 = 1200.0f'))
p=Path('tests/state_control_test.cpp')
t=p.read_text()
old_t='CHECK(controller.debug().vertical_accel_mps2 > 49.4f);\n    CHECK(controller.debug().vertical_accel_mps2 < 49.7f);'
new_t='CHECK(controller.debug().vertical_accel_mps2 > 48.7f);\n    CHECK(controller.debug().vertical_accel_mps2 < 48.9f);'
if t.count(old_t)!=1: raise SystemExit(f'vertical test marker mismatch: {t.count(old_t)}')
p.write_text(t.replace(old_t,new_t,1))
PY

# Source/architecture gates.
g++ -std=c++17 -O2 -Wall -Wextra -Wpedantic -Werror -Iesp32 tests/drone_fc_core_test.cpp -o /tmp/fc_core_test
/tmp/fc_core_test
g++ -std=c++17 -O2 -Wall -Wextra -Wpedantic -Werror -Iesp32 tests/state_control_test.cpp -o /tmp/state_control_test
/tmp/state_control_test
g++ -std=c++17 -O1 -g -Wall -Wextra -Wpedantic -Werror -fsanitize=address,undefined -fno-omit-frame-pointer -Iesp32 tests/drone_hil_protocol_test.cpp -o /tmp/hil_test
ASAN_OPTIONS=detect_leaks=1 /tmp/hil_test
g++ -std=c++17 -O2 -Wall -Wextra -Wpedantic -Werror -Iesp32 sim/Arondight45_DroneFC_SIL_WASM.cpp -o /tmp/sil_test
/tmp/sil_test
node tests/control_semantics_test.mjs
node tests/xbox_gamepad_test.mjs
node tests/camera_stabilization_test.mjs
node tests/render_stability_test.mjs
node tests/vs_pose_sync_test.mjs
node tests/physics_validation_test.mjs
node tests/world_building_collisions_test.mjs
node tests/airframe_collision_envelope_test.mjs
node tests/component_mass_model_test.mjs
node tests/propulsion_authority_test.mjs
node tests/s31_digital_twin_audit_test.mjs
node tests/lan_vs_smoke.mjs
node tests/architecture_invariants.mjs
find sim tests tools -type f -name '*.mjs' -print0 | xargs -0 -n1 node --check
test "$(find .github/workflows -maxdepth 1 -type f -printf '%f\n' | sort | tr '\n' ' ')" = "deploy.yml s31-hil.yml "

# Exact shared controller WebAssembly.
mkdir -p generated
docker run --rm -v "$PWD:/src" -w /src emscripten/emsdk:4.0.10 \
  em++ sim/Arondight45_DroneFC_SIL_WASM.cpp -std=c++17 -O3 \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT='web' -s INVOKE_RUN=0 -s EXIT_RUNTIME=0 -s FILESYSTEM=0 -s SINGLE_FILE=1 \
  -s ALLOW_MEMORY_GROWTH=0 -s INITIAL_MEMORY=16777216 -s EXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
  -s EXPORTED_FUNCTIONS='["_fc_input_buffer","_fc_output_buffer","_fc_input_size","_fc_output_size","_fc_reset","_fc_process","_fc_protocol_version"]' \
  -o generated/flight_core.mjs
docker run --rm -v "$PWD:/src" -w /src emscripten/emsdk:4.0.10 \
  em++ sim/Arondight45_DroneFC_SIL_WASM.cpp -std=c++17 -O3 \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT='node' -s INVOKE_RUN=0 -s EXIT_RUNTIME=0 -s FILESYSTEM=0 -s SINGLE_FILE=1 \
  -s ALLOW_MEMORY_GROWTH=0 -s INITIAL_MEMORY=16777216 -s EXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
  -s EXPORTED_FUNCTIONS='["_fc_input_buffer","_fc_output_buffer","_fc_input_size","_fc_output_size","_fc_reset","_fc_process","_fc_protocol_version"]' \
  -o generated/flight_core_node.mjs
node tests/sil_wasm_smoke.mjs generated/flight_core_node.mjs

# Build simulator, controller and real photogrammetry as separate lazy bundle.
BUILD=/tmp/arondight-final-build
rm -rf "$BUILD" && mkdir -p "$BUILD" && cd "$BUILD"
npm init -y >/dev/null
npm install --ignore-scripts --no-audit --no-fund \
  three@0.185.1 box3d.js@0.1.1 maplibre-gl@5.24.0 3d-tiles-renderer@0.5.0 esbuild@0.25.8 puppeteer-core@24.16.0 mqtt@5.15.2 nostr-tools@2.24.1 \
  qrcode-generator@1.4.4 jsqr@1.4.0 trystero@0.25.3 @trystero-p2p/mqtt@0.25.3 @trystero-p2p/torrent@0.25.3
ln -s "$BUILD/node_modules" "$GITHUB_WORKSPACE/node_modules"
cd "$GITHUB_WORKSPACE"
node tests/world_building_collision_box3d_test.mjs ./node_modules/box3d.js/dist/box3d.inline.mjs
./node_modules/.bin/esbuild sim/real_world_bootstrap.mjs --bundle --format=esm --platform=browser --target=es2022 --minify --alias:box3d.js/dist/box3d.inline.mjs=box3d.js/inline --outfile=/tmp/arondight45-simulator.bundle.mjs
./node_modules/.bin/esbuild sim/photorealistic_3d_tiles.mjs --bundle --format=esm --platform=browser --target=es2022 --minify --outfile=sim/photorealistic_3d_tiles.bundle.mjs
./node_modules/.bin/esbuild sim/controller.mjs --bundle --format=esm --platform=browser --target=es2022 --minify --outfile=/tmp/arondight45-controller.bundle.mjs
node --check /tmp/arondight45-simulator.bundle.mjs
node --check sim/photorealistic_3d_tiles.bundle.mjs
node --check /tmp/arondight45-controller.bundle.mjs
test "$(wc -c < sim/photorealistic_3d_tiles.bundle.mjs)" -gt 100000
grep -q 'GoogleCloudAuthPlugin' sim/photorealistic_3d_tiles.mjs
grep -q 'maxBytesSize' sim/photorealistic_3d_tiles.mjs
grep -q 'dispose-model' sim/photorealistic_3d_tiles.mjs
grep -q 'import(PHOTOREAL_BUNDLE_URL)' sim/real_world_bootstrap.mjs

python3 - <<'PY'
import json,os
from pathlib import Path
sha=os.environ['GITHUB_SHA']
key=os.environ.get('GOOGLE_MAP_TILES_BROWSER_KEY','').strip()
key_bootstrap='<script>globalThis.__ARONDIGHT45_GOOGLE_MAP_TILES_API_KEY__='+json.dumps(key)+'</script>\n'
for html_name,marker,bundle_name in [
    ('drone_simulator.html','<script type="module" src="./sim/real_world_bootstrap.mjs"></script>','/tmp/arondight45-simulator.bundle.mjs'),
    ('drone_controller.html','<script type="module" src="./sim/controller.mjs"></script>','/tmp/arondight45-controller.bundle.mjs')]:
    p=Path(html_name); h=p.read_text(); assert marker in h
    b=Path(bundle_name).read_text().replace('</script','<\\/script')
    p.write_text(f'<!-- ARONDIGHT45_BUILD_SHA:{sha} -->\n'+key_bootstrap+h.replace(marker,'<script type="module">\n'+b+'\n</script>'))
PY

# Browser gates against exactly the built artifact.
CHROME_BIN="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$CHROME_BIN"
python3 -m http.server 4174 --bind 127.0.0.1 >/tmp/final-http.log 2>&1 &
HTTP_PID=$!
trap 'kill "$HTTP_PID" 2>/dev/null || true' EXIT
sleep 1
CHROME_BIN="$CHROME_BIN" node tests/solo_layout_smoke.mjs http://127.0.0.1:4174
CHROME_BIN="$CHROME_BIN" node tests/takeoff_agl_browser_smoke.mjs http://127.0.0.1:4174/drone_simulator.html
CHROME_BIN="$CHROME_BIN" node tests/browser_sim_smoke.mjs http://127.0.0.1:4174/drone_simulator.html
CHROME_BIN="$CHROME_BIN" node tests/xbox_gamepad_browser_smoke.mjs http://127.0.0.1:4174
CHROME_BIN="$CHROME_BIN" node tests/android_render_browser_smoke.mjs http://127.0.0.1:4174
kill "$HTTP_PID" 2>/dev/null || true
trap - EXIT

# Browser build artifacts are regenerated by the final production workflow.
git checkout -- drone_simulator.html drone_controller.html
rm -rf generated node_modules sim/photorealistic_3d_tiles.bundle.mjs

# Never clobber an unrelated concurrent main update.
git fetch origin main
test "$(git rev-parse origin/main)" = "$GITHUB_SHA"
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add -A
git commit -m 'Finalize smooth flight handoff and real photogrammetry streaming'
git push origin HEAD:main
echo "product_sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
