from pathlib import Path


def replace_one(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    assert count == 1, f"{path}: expected exactly one match, got {count}: {old[:120]!r}"
    p.write_text(text.replace(old, new, 1))


# A software WebGL renderer has no GPU raster budget to borrow from. Detect that
# real runtime capability and start the presentation backbuffer at the existing
# quality floor immediately. Hardware renderers still start at full configured
# quality and use the measured cadence governor from v1.
replace_one(
    "sim/simulator.mjs",
    'const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});const presentationNativePixelRatio=Math.min(devicePixelRatio||1,PRESENTATION_PIXEL_RATIO_MAX);let presentationPixelRatio=presentationNativePixelRatio;renderer.setPixelRatio(presentationPixelRatio);',
    'const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});const presentationGl=renderer.getContext(),presentationRendererInfo=presentationGl.getExtension("WEBGL_debug_renderer_info"),presentationRendererName=String(presentationGl.getParameter(presentationRendererInfo?.UNMASKED_RENDERER_WEBGL||presentationGl.RENDERER)||"");const presentationSoftwareRaster=/(swiftshader|llvmpipe|software raster|software renderer)/i.test(presentationRendererName),presentationNativePixelRatio=Math.min(devicePixelRatio||1,PRESENTATION_PIXEL_RATIO_MAX);let presentationPixelRatio=presentationSoftwareRaster?Math.min(presentationNativePixelRatio,PRESENTATION_PIXEL_RATIO_MIN):presentationNativePixelRatio;renderer.setPixelRatio(presentationPixelRatio);',
)

replace_one(
    "tests/architecture_invariants.mjs",
    'requireText("sim/simulator.mjs","PRESENTATION_PIXEL_RATIO_MAX = 1.25");',
    '''requireText("sim/simulator.mjs","PRESENTATION_PIXEL_RATIO_MAX = 1.25");
requireText("sim/simulator.mjs",'presentationGl.getExtension("WEBGL_debug_renderer_info")');
requireText("sim/simulator.mjs","presentationSoftwareRaster");
requireText("sim/simulator.mjs","swiftshader|llvmpipe|software raster|software renderer");''',
)

# Expose the selected backbuffer in the performance gate so release logs prove
# whether the browser was hardware- or software-rasterized without changing pass
# criteria.
replace_one(
    "tests/browser_sim_smoke.mjs",
    'const cadenceEnd=await page.evaluate(()=>{const d=globalThis.__arondightDiagnostics;return{wall:performance.now(),sim:Number(d?.simTime),draws:Number(d?.presentationDraws||0),backlog:Number(d?.simulationBacklogMs||0),uiSim:parseFloat(document.querySelector("#simTime")?.textContent||"0")};});',
    'const cadenceEnd=await page.evaluate(()=>{const d=globalThis.__arondightDiagnostics;return{wall:performance.now(),sim:Number(d?.simTime),draws:Number(d?.presentationDraws||0),backlog:Number(d?.simulationBacklogMs||0),pixelRatio:Number(d?.presentationPixelRatio||0),uiSim:parseFloat(document.querySelector("#simTime")?.textContent||"0")};});',
)
replace_one(
    "tests/browser_sim_smoke.mjs",
    'console.log(`Realtime fixed-step cadence: ${cadenceRatio.toFixed(3)}x · presentation draws ${presentationDraws} · backlog ${cadenceEnd.backlog.toFixed(2)} ms · HUD lag ${uiClockLag.toFixed(3)} s`);',
    'console.log(`Realtime fixed-step cadence: ${cadenceRatio.toFixed(3)}x · presentation draws ${presentationDraws} · pixel ratio ${cadenceEnd.pixelRatio.toFixed(2)} · backlog ${cadenceEnd.backlog.toFixed(2)} ms · HUD lag ${uiClockLag.toFixed(3)} s`);',
)

replace_one(
    "REAL_WORLD_DIGITAL_TWIN.md",
    "Training starts at up to 1.25 CSS pixel ratio and measures authoritative simulator-time versus wall-time in 250 ms windows. Only when presentation pressure demonstrably pulls cadence below target may the THREE backbuffer step down, to 0.80 and ultimately 0.60; sustained headroom is required before resolution recovers.",
    "Hardware-accelerated WebGL starts at up to 1.25 CSS pixel ratio and measures authoritative simulator-time versus wall-time in 250 ms windows. A browser that reports a software rasterizer such as SwiftShader or llvmpipe starts directly at the same 0.60 presentation floor because it has no GPU raster budget; this is a renderer-capability choice, not a simulation-time choice. On hardware WebGL, only measured presentation pressure may step the THREE backbuffer down to 0.80 and ultimately 0.60, and sustained headroom is required before resolution recovers.",
)
