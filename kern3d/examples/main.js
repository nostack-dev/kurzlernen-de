import * as KERN from "../src/Kern.js";

const canvas = document.getElementById("view");
const hud = document.getElementById("hud");
const renderer = new KERN.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x0e1116);

const scene = new KERN.Scene();
scene.fog = new KERN.Fog(0x0e1116, 18, 46);
scene.background = new KERN.Color(0x0e1116);

const camera = new KERN.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(7.5, 4.2, 9);
const controls = new KERN.OrbitControls(camera, canvas);
controls.target.set(0, 0.8, 0);
controls.update();

scene.add(new KERN.AmbientLight(0x8aa0c8, 0.18));

const sun = new KERN.DirectionalLight(0xfff4e0, 1.15);
sun.position.set(6, 10, 4);
scene.add(sun);
scene.add(sun.target);

const warm = new KERN.PointLight(0xff7a3c, 2.4, 14);
warm.position.set(-3.2, 2.2, 2.4);
scene.add(warm);

const cool = new KERN.PointLight(0x4aa3ff, 2.1, 12);
cool.position.set(3.4, 1.6, -2.6);
scene.add(cool);

scene.add(new KERN.GridHelper(20, 20, 0x6d7c90, 0x2a3340));

const floor = new KERN.Mesh(
  new KERN.PlaneGeometry(20, 20),
  new KERN.MeshPhongMaterial({ color: 0x1a212b, shininess: 40, specular: 0x222222 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.001;
scene.add(floor);

const checker = document.createElement("canvas");
checker.width = checker.height = 128;
const ctx = checker.getContext("2d");
for (let y = 0; y < 8; y++) {
  for (let x = 0; x < 8; x++) {
    ctx.fillStyle = (x + y) % 2 === 0 ? "#e8d7bf" : "#8d5a3c";
    ctx.fillRect(x * 16, y * 16, 16, 16);
  }
}
const map = new KERN.Texture(checker);

const box = new KERN.Mesh(
  new KERN.BoxGeometry(1.4, 1.4, 1.4),
  new KERN.MeshPhongMaterial({ color: 0xffffff, map, shininess: 24, specular: 0x333333 }),
);
box.position.set(-2.2, 0.7, 0.4);
scene.add(box);

const sphere = new KERN.Mesh(
  new KERN.SphereGeometry(0.85, 48, 24),
  new KERN.MeshPhongMaterial({ color: 0xd7e4f5, shininess: 90, specular: 0xffffff }),
);
sphere.position.set(0.4, 0.85, 1.3);
scene.add(sphere);

const torus = new KERN.Mesh(
  new KERN.TorusGeometry(0.7, 0.26, 20, 48),
  new KERN.MeshPhongMaterial({ color: 0x3ddc97, shininess: 50, specular: 0x88ffcc }),
);
torus.position.set(2.4, 0.9, -0.6);
scene.add(torus);

const cubes = [];
for (let i = 0; i < 5; i++) {
  const m = new KERN.Mesh(
    new KERN.BoxGeometry(0.45, 0.45 + i * 0.12, 0.45),
    new KERN.MeshPhongMaterial({
      color: [0xf2c14e, 0xe85d4c, 0x6c8cff, 0xc084fc, 0x5eead4][i],
      shininess: 40,
      specular: 0x444444,
    }),
  );
  m.position.set(-1.6 + i * 0.85, 0.25 + i * 0.06, -2.2);
  scene.add(m);
  cubes.push(m);
}

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

let frames = 0;
let last = performance.now();
let acc = 0;
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  box.rotation.y += dt * 0.45;
  box.rotation.x += dt * 0.18;
  torus.rotation.x += dt * 0.7;
  torus.rotation.y += dt * 0.35;
  sphere.position.y = 0.85 + Math.sin(now * 0.0016) * 0.18;
  warm.position.x = Math.sin(now * 0.0007) * 3.2;
  cool.position.z = Math.cos(now * 0.0009) * 3.0;
  for (let i = 0; i < cubes.length; i++) cubes[i].rotation.y += dt * (0.4 + i * 0.12);
  controls.update();
  renderer.render(scene, camera);
  frames++;
  acc += dt;
  if (acc >= 0.4) {
    hud.textContent = `${Math.round(frames / acc)} fps  ·  kern3d ${KERN.REVISION}`;
    frames = 0;
    acc = 0;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
