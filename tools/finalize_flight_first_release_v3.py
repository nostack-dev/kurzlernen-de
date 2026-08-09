from pathlib import Path


def replace_one(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    assert count == 1, f"{path}: expected exactly one match, got {count}: {old[:120]!r}"
    p.write_text(text.replace(old, new, 1))


# Software rasterization is a real runtime capability constraint, not flight truth.
# Keep at least ~16.7 visible frames/s there while giving the 1 kHz authority path
# first claim on CPU. Hardware WebGL retains the existing display-rate/adaptive path.
replace_one(
    "sim/simulator.mjs",
    '''  const minDrawInterval=backlog>=PRESENTATION_HARD_BACKLOG_MS?PRESENTATION_MAX_DRAW_GAP_MS:
    backlog>=PRESENTATION_CONSTRAINED_BACKLOG_MS?33:
    backlog>=PRESENTATION_SOFT_BACKLOG_MS?22:0;
  const forceDraw=sinceDraw>=PRESENTATION_MAX_DRAW_GAP_MS;
  const drawDue=forceDraw||(backlog<PRESENTATION_SKIP_DRAW_BACKLOG_MS&&sinceDraw>=minDrawInterval);''',
    '''  const minDrawInterval=backlog>=PRESENTATION_HARD_BACKLOG_MS?PRESENTATION_MAX_DRAW_GAP_MS:
    backlog>=PRESENTATION_CONSTRAINED_BACKLOG_MS?33:
    backlog>=PRESENTATION_SOFT_BACKLOG_MS?22:0;
  const softwareRasterDrawInterval=presentationSoftwareRaster?60:0;
  const effectiveDrawInterval=Math.max(minDrawInterval,softwareRasterDrawInterval);
  const forceDraw=sinceDraw>=PRESENTATION_MAX_DRAW_GAP_MS;
  const drawDue=forceDraw||(backlog<PRESENTATION_SKIP_DRAW_BACKLOG_MS&&sinceDraw>=effectiveDrawInterval);''',
)

replace_one(
    "tests/architecture_invariants.mjs",
    'requireText("sim/simulator.mjs","presentationSoftwareRaster");',
    '''requireText("sim/simulator.mjs","presentationSoftwareRaster");
requireText("sim/simulator.mjs","softwareRasterDrawInterval=presentationSoftwareRaster?60:0");
requireText("sim/simulator.mjs","effectiveDrawInterval=Math.max(minDrawInterval,softwareRasterDrawInterval)");''',
)

replace_one(
    "REAL_WORLD_DIGITAL_TWIN.md",
    "A browser that reports a software rasterizer such as SwiftShader or llvmpipe starts directly at the same 0.60 presentation floor because it has no GPU raster budget; this is a renderer-capability choice, not a simulation-time choice.",
    "A browser that reports a software rasterizer such as SwiftShader or llvmpipe starts directly at the same 0.60 presentation floor and caps presentation draw work to roughly 16–17 fps because it has no GPU raster budget; this is a renderer-capability choice, not a simulation-time choice. Hardware WebGL keeps the normal display-rate/adaptive draw path.",
)
