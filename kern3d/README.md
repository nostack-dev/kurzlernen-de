# kern3d

Minimaler, eigener 3D-Kern für den Browser. Die API lehnt sich an Three.js an (`Scene`, `PerspectiveCamera`, `Mesh`, `WebGLRenderer`), der Code ist eine unabhängige Implementierung — kein Fork des Three.js-Repos, keine Build-Pipeline, keine Abhängigkeiten.

Ziel: stabiler Render-Kern, den du später zu deiner eigenen Engine ausbauen kannst. Nur das, was eine Szene im Browser zeichnet.

## Start

ES-Module brauchen einen lokalen Server (nicht `file://`).

```bash
cd kern3d
python3 -m http.server 8080
```

Dann `http://localhost:8080/examples/` öffnen.

Ziehen dreht, Shift-Ziehen schiebt, Mausrad zoomt.

## Was drin ist

- Math: `Vector3`, `Euler`, `Quaternion`, `Matrix4`, `Color`
- Graph: `Object3D`, `Scene`, Parent/Child, `matrixWorld`
- Kameras: `PerspectiveCamera`, `OrthographicCamera`
- Geometrie: `BufferGeometry`, `Box`, `Plane`, `Sphere`, `Torus`
- Materialien: `MeshBasicMaterial` (unlit), `MeshPhongMaterial` (Blinn-Phong)
- Licht: `AmbientLight`, `DirectionalLight` (max 4), `PointLight` (max 8, Distanz-Falloff)
- Renderer: WebGL2, ein Shader-Programm, VAO-Cache, sRGB-Output, optional Textur und linearer Fog
- `OrbitControls`, `GridHelper`

Bewusst nicht drin: Loader, Postprocessing, Schatten, PBR, Audio, Physik, npm, Bundler.

## Mini-Beispiel

```js
import * as KERN from "./src/Kern.js";

const renderer = new KERN.WebGLRenderer({ antialias: true });
document.body.appendChild(renderer.domElement);

const scene = new KERN.Scene();
const camera = new KERN.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(3, 2, 5);

scene.add(new KERN.AmbientLight(0xffffff, 0.2));
const sun = new KERN.DirectionalLight(0xffffff, 1);
sun.position.set(4, 8, 2);
scene.add(sun);

const mesh = new KERN.Mesh(
  new KERN.BoxGeometry(1, 1, 1),
  new KERN.MeshPhongMaterial({ color: 0xe85d4c, shininess: 40 }),
);
scene.add(mesh);

renderer.setSize(innerWidth, innerHeight);
renderer.render(scene, camera);
```

Rotationen sind im Bogenmaß, Farben als Hex (`0xff8844`) oder `Color`.

## Wo du ansetzt

| Datei | Rolle |
| --- | --- |
| `src/renderers/WebGLRenderer.js` | Draw-Loop, Uniforms, Buffer-Upload |
| `src/renderers/shaders.js` | Vertex/Fragment, hier kommt PBR oder Schatten hin |
| `src/core/Object3D.js` | Szenengraph |
| `src/geometries/Geometries.js` | Neue Primitive |
| `src/Kern.js` | Public API |

Der Renderer lädt Geometrie einmal in VAOs und zeichnet pro Mesh einen Draw-Call. Nächste sinnvolle Schritte, wenn du den Kern erweiterst: Frustum-Culling, Uniform-Buffer für Lichter, Instancing, eine eigene `MeshStandardMaterial`.

## Lizenz

MIT. Die Form der API ist von Three.js inspiriert (mrdoob, MIT). Der Quelltext hier ist eigenständig und enthält keinen Three.js-Code.
