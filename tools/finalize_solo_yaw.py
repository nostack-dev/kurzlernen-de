from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one source pattern, found {count}")
    p.write_text(text.replace(old, new, 1))


# Solo and two-phone GAME drive the same yaw state controller. Keep the physical
# >4 degree gate and 220 ms observation window identical, and use the same 65%
# horizontal yaw stimulus. The old solo smoke used only 45% plus camera-look Y,
# so it was testing a materially weaker command than the already-proven dual path.
replace_once(
    "tests/browser_sim_smoke.mjs",
    '''  await page.mouse.move(right.cx+right.r*.45,right.cy-right.r*.2,{steps:5});\n  const turnStart=await simTime();await waitForSimTime(turnStart+.25,25000);await page.mouse.up();''',
    '''  await page.mouse.move(right.cx+right.r*.65,right.cy,{steps:5});\n  const turnStart=await simTime();await waitForSimTime(turnStart+.22,25000);await page.mouse.up();''',
)

architecture = Path("tests/architecture_invariants.mjs")
arch = architecture.read_text()
anchor = '''requireText("tests/dual_phone_smoke.mjs","rcx+rr*.65",\n            "yaw E2E stimulus must make the unchanged four-degree physical rotation gate reachable after phone/C++ shaping");\n'''
addition = '''requireText("tests/browser_sim_smoke.mjs","right.cx+right.r*.65,right.cy",\n            "solo GAME yaw smoke must use the same 65-percent physical yaw stimulus as dual-phone GAME");\nrequireText("tests/browser_sim_smoke.mjs","turnStart+.22",\n            "solo GAME yaw smoke must retain the same 220 ms physical response window as dual-phone GAME");\n'''
if addition not in arch:
    if anchor not in arch:
        raise RuntimeError("architecture dual-phone yaw anchor missing")
    arch = arch.replace(anchor, anchor + addition, 1)
architecture.write_text(arch)

solo = Path("tests/browser_sim_smoke.mjs").read_text()
assert 'right.cx+right.r*.65,right.cy' in solo
assert 'turnStart+.22' in solo
assert 'if(Math.abs(yawDelta)<4)' in solo
