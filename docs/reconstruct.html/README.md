# Datenkodierung mit Rauschen (reconstruct.html)

## Idea
This app demonstrates how a noisy signal can still be reconstructed if you know the underlying sinusoid. Sliders control amplitude, frequency, phase, noise strength, and sample count; a Chart.js plot shows both noisy measurements and the reconstructed curve.

## Process
1. **Signal generation** – Given `A`, `f`, and `φ`, the script computes `y = A sin(2π f t + φ)` for `N` samples. Uniform noise scaled by `dataNoiseRangeAmplitude` is added to mimic measurement errors.
2. **Encoding** – The “save parameters” button exports the current settings and noisy data to JSON, illustrating how you might transmit the signal description instead of every sample.
3. **Reconstruction** – Clicking “Kurve rekonstruieren” regenerates the clean sinusoid using the stored parameters and overlays it on the chart so learners can compare raw vs reconstructed data.
4. **Visualization** – Chart.js handles rendering. The zoom plugin allows panning/zooming for detailed inspection of error bands.

## UI map
- Sidebar cards provide tactile feedback for each slider value.
- Header buttons manage persistence: save parameters, load a JSON file, or rebuild the curve.
- Main panel contains the dual-line chart plus textual summaries (mean error, SNR) under the graph.

## Try it yourself
- Raise noise amplitude to 1.0 and observe how reconstruction still hugs the underlying sine because the model knows the phase.
- Reduce sample count to explore aliasing effects; challenge students to spot when the reconstruction diverges.
- Export parameters, reload the page, and use “Parameter laden” to showcase reproducibility.

## Developer notes
- Parameters are stored in a simple object—extend it with polynomial terms or harmonics to teach Fourier decomposition.
- Chart datasets are updated in place, so the animation remains smooth even with frequent slider changes.
- Because the theme uses DaisyUI via CDN, customizing colors is as easy as switching the `data-theme` attribute on `<html>`.

This tool connects abstract encoding theory with a tangible slider experiment: noisy data in, pristine reconstruction out.
