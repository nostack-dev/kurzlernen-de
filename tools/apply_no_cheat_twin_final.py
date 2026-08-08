from pathlib import Path
import runpy

path = Path("esp32/Arondight45_DroneFC_S31.cpp")
text = path.read_text()
weak = 'extern "C" bool __attribute__((weak)) arondight45_navigation_sample(float* vx_mps,float* vy_mps,float* vz_mps,float* agl_m){(void)vx_mps;(void)vy_mps;(void)vz_mps;(void)agl_m;return false;}\n\n'
if weak in text:
    if text.count(weak) != 1:
        raise RuntimeError("weak cooked navigation callback is ambiguous")
    path.write_text(text.replace(weak, "", 1))

runpy.run_path("tools/apply_no_cheat_twin_v2.py", run_name="__main__")

if "arondight45_navigation_sample" in path.read_text():
    raise RuntimeError("cooked navigation callback survived migration")
