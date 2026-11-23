/* =========================================================
   AQUARIUM — real-time WebGL scene
   Three.js r161 · procedural fish, plants, caustics, bubbles
   ========================================================= */

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/* ---------------------------------------------------------
   Constants
   --------------------------------------------------------- */

const TANK = { w: 10, h: 5, d: 5, sandY: -2.32, waterY: 2.1, rimY: 2.5 };
const UP = new THREE.Vector3(0, 1, 0);
const clock = new THREE.Clock();
const canvas = document.getElementById("tank");
const feedBtn = document.getElementById("feedBtn");
const loader = document.getElementById("loader");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let renderer, scene, camera, composer;
let causticTexture, waterSurface, waterBump;
let grassMaterial, grassUniform;
let sandMesh;
const plantGroups = [];
const fishes = [];
const pellets = [];
const rays = [];

const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
const CAMERA_Z = { value: 12 };

/* ---------------------------------------------------------
   Init
   --------------------------------------------------------- */

function init() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020507);
  scene.fog = new THREE.FogExp2(0x04171e, 0.022);

  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  camera.position.set(0.4, 1.0, CAMERA_Z.value);
  camera.lookAt(0, -0.2, 0);

  /* Environment reflections for glass & wet surfaces */
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  buildBackdrop();
  buildLights();
  buildTank();
  buildSand();
  buildRocks();
  buildPlants();
  buildFish();
  buildBubbles();
  buildDust();
  buildLightRays();
  buildWaterSurface();
  buildCaustics();

  /* Post processing */
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.2,
    0.55,
    0.9
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  fitCamera();
  onResize();
  window.addEventListener("resize", onResize);

  bindUI();
  animate();

  /* Reveal */
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      document.body.classList.add("ready");
      if (loader) {
        loader.classList.add("is-done");
        window.setTimeout(() => loader.remove(), 1300);
      }
    })
  );
}

/* ---------------------------------------------------------
   Camera
   --------------------------------------------------------- */

function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const needW = TANK.w + 2.6;
  const needH = TANK.h + 2.2;

  const distW = needW / 2 / (Math.tan(fov / 2) * aspect);
  const distH = needH / 2 / Math.tan(fov / 2);

  CAMERA_Z.value = Math.max(distW, distH, 9.8);
  camera.aspect = aspect;
  camera.position.z = CAMERA_Z.value;
  camera.updateProjectionMatrix();
}

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  fitCamera();
  renderer.setSize(width, height);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(width, height);
}

/* ---------------------------------------------------------
   Helpers
   --------------------------------------------------------- */

function canvasTexture(canvas, repeatX = 1, repeatY = 1, srgb = true) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/* deterministic hash noise, used for terrain-ish detail */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/* tileable value noise */
function valueNoise(x, y, period) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const wrap = (n) => ((n % period) + period) % period;
  const a = hash2(wrap(xi), wrap(yi));
  const b = hash2(wrap(xi + 1), wrap(yi));
  const c = hash2(wrap(xi), wrap(yi + 1));
  const d = hash2(wrap(xi + 1), wrap(yi + 1));
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, octaves = 4, period = 64) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, y * frequency, period * frequency) * amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return value;
}

/* build a tangent-space normal map from a height function */
function makeNormalTexture(size, heightAt, strength = 2) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const image = ctx.createImageData(size, size);

  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      height[y * size + x] = heightAt(x / size, y / size);
    }
  }

  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      image.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      image.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      image.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/* normalize arbitrary ShapeGeometry UVs into 0..1 so textures map sanely */
function normalizeUV(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const size = new THREE.Vector2(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
  const uv = geometry.attributes.uv;
  const pos = geometry.attributes.position;

  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      (pos.getX(i) - bb.min.x) / (size.x || 1),
      (pos.getY(i) - bb.min.y) / (size.y || 1)
    );
  }
  uv.needsUpdate = true;
  return geometry;
}

/* ---------------------------------------------------------
   Backdrop & floor
   --------------------------------------------------------- */

function buildBackdrop() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext("2d");

  const g = ctx.createRadialGradient(512, 250, 30, 512, 300, 620);
  g.addColorStop(0, "#123943");
  g.addColorStop(0.38, "#0a232b");
  g.addColorStop(0.72, "#041014");
  g.addColorStop(1, "#020507");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);

  /* soft light haze */
  const haze = ctx.createLinearGradient(0, 0, 0, 512);
  haze.addColorStop(0, "rgba(120, 210, 225, 0.10)");
  haze.addColorStop(0.4, "rgba(40, 110, 130, 0.03)");
  haze.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, 1024, 512);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 24),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(c, 1, 1),
      depthWrite: false,
      fog: false,
    })
  );
  backdrop.position.set(0, 2, -10);
  scene.add(backdrop);

  /* Studio floor */
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 34),
    new THREE.MeshStandardMaterial({
      color: 0x04080a,
      roughness: 0.42,
      metalness: 0.65,
      envMapIntensity: 0.35,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.98;
  floor.receiveShadow = true;
  scene.add(floor);

  /* Light pooling under the tank */
  const pool = makeRadialTexture("rgba(110, 225, 235, 0.35)", "rgba(20, 60, 70, 0)");
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(19, 9),
    new THREE.MeshBasicMaterial({
      map: pool,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, -2.95, 0.4);
  scene.add(glow);
}

function makeRadialTexture(inner, outer) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 4, 128, 128, 128);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return canvasTexture(c, 1, 1);
}

/* ---------------------------------------------------------
   Lights
   --------------------------------------------------------- */

function buildLights() {
  /* sky / water ambient */
  scene.add(new THREE.HemisphereLight(0xbfeefc, 0x0a1f18, 0.42));

  /* warm key light from the room above the tank */
  const sun = new THREE.DirectionalLight(0xfff4e4, 2.35);
  sun.position.set(3.2, 9, 5.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 26;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 2.5;
  scene.add(sun);

  /* cool rim from behind, separates fish from the background */
  const rim = new THREE.DirectionalLight(0x63d4f2, 0.95);
  rim.position.set(-5, 3.4, -6.5);
  scene.add(rim);

  /* aquarium hood lamp */
  const overhead = new THREE.SpotLight(0xdff5ff, 185, 0, 0.9, 0.95, 1.5);
  overhead.position.set(0, 7.2, 1.2);
  overhead.target.position.set(0, 0, 0);
  scene.add(overhead, overhead.target);

  /* water bounce, bluish from below-front */
  const coolFill = new THREE.PointLight(0x2f9fc4, 11, 16, 2);
  coolFill.position.set(-4.4, 0.6, 3.6);
  scene.add(coolFill);

  /* faint warm accent in the upper right */
  const warmFill = new THREE.PointLight(0xffcf96, 4.5, 13, 2);
  warmFill.position.set(3.9, 2.7, 2.6);
  scene.add(warmFill);
}

/* ---------------------------------------------------------
   Tank
   --------------------------------------------------------- */

function buildTank() {
  const tank = new THREE.Group();
  scene.add(tank);

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc6ecf5,
    metalness: 0,
    roughness: 0.018,
    transparent: true,
    opacity: 0.075,
    envMapIntensity: 2.6,
    clearcoat: 1,
    clearcoatRoughness: 0.015,
    ior: 1.52,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const panel = (w, h, x, y, z, ry = 0) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMaterial);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.renderOrder = 12;
    tank.add(mesh);
    return mesh;
  };

  panel(TANK.w, TANK.h, 0, 0, TANK.d / 2);
  panel(TANK.w, TANK.h, 0, 0, -TANK.d / 2, Math.PI);
  panel(TANK.d, TANK.h, -TANK.w / 2, 0, 0, Math.PI / 2);
  panel(TANK.d, TANK.h, TANK.w / 2, 0, 0, -Math.PI / 2);

  const bottom = new THREE.Mesh(
    new THREE.PlaneGeometry(TANK.w, TANK.d),
    glassMaterial
  );
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = TANK.sandY - 0.16;
  bottom.renderOrder = 12;
  tank.add(bottom);

  /* Frame */
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x0b1114,
    metalness: 0.85,
    roughness: 0.32,
    envMapIntensity: 1,
  });

  const bar = (w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMaterial);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    tank.add(mesh);
  };

  const t = 0.11;
  const halfW = TANK.w / 2;
  const halfD = TANK.d / 2;
  const topY = TANK.rimY;
  const bottomY = TANK.sandY - 0.16;

  /* vertical corners */
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      bar(t, TANK.h, t, sx * halfW, 0, sz * halfD);
    }
  }

  /* top rim */
  bar(TANK.w + t, t * 1.5, t, 0, topY, halfD);
  bar(TANK.w + t, t * 1.5, t, 0, topY, -halfD);
  bar(t, t * 1.5, TANK.d + t, halfW, topY, 0);
  bar(t, t * 1.5, TANK.d + t, -halfW, topY, 0);

  /* bottom rim */
  bar(TANK.w + t, t, t, 0, bottomY, halfD);
  bar(TANK.w + t, t, t, 0, bottomY, -halfD);
  bar(t, t, TANK.d + t, halfW, bottomY, 0);
  bar(t, t, TANK.d + t, -halfW, bottomY, 0);

  /* Plinth */
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(TANK.w + 0.9, 0.42, TANK.d + 0.9),
    new THREE.MeshStandardMaterial({
      color: 0x060a0c,
      metalness: 0.5,
      roughness: 0.55,
    })
  );
  plinth.position.y = bottomY - 0.28;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  tank.add(plinth);

  /* Waterline glow */
  const lineMaterial = new THREE.MeshBasicMaterial({
    color: 0x9fe6ee,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const line = (w, d, x, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), lineMaterial);
    mesh.position.set(x, TANK.waterY, z);
    tank.add(mesh);
  };

  line(TANK.w - 0.04, 0.02, 0, halfD - 0.02);
  line(TANK.w - 0.04, 0.02, 0, -halfD + 0.02);
  line(0.02, TANK.d - 0.04, halfW - 0.02, 0);
  line(0.02, TANK.d - 0.04, -halfW + 0.02, 0);

  /* glass reflections: faint room highlights + smudges on the front pane */
  const reflection = new THREE.Mesh(
    new THREE.PlaneGeometry(TANK.w, TANK.h),
    new THREE.MeshBasicMaterial({
      map: makeGlassReflectionTexture(),
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
  );
  reflection.name = "glassReflection";
  reflection.position.set(0, 0, halfD + 0.004);
  reflection.renderOrder = 13;
  tank.add(reflection);

  /* bright edge highlights where the glass catches the light */
  const edgeMaterial = new THREE.MeshBasicMaterial({
    color: 0xbdf0fa,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const edge = (x, z, ry) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.02, TANK.h), edgeMaterial);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = ry;
    mesh.renderOrder = 13;
    tank.add(mesh);
  };
  edge(-halfW + 0.015, halfD + 0.006, 0);
  edge(halfW - 0.015, halfD + 0.006, 0);
  edge(0, -halfD + 0.006, 0);
}

function makeGlassReflectionTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 512, 256);

  /* soft diagonal light band */
  const streak = ctx.createLinearGradient(40, 0, 250, 256);
  streak.addColorStop(0, "rgba(255,255,255,0)");
  streak.addColorStop(0.45, "rgba(210,245,255,0.10)");
  streak.addColorStop(0.55, "rgba(230,250,255,0.16)");
  streak.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = streak;
  ctx.beginPath();
  ctx.moveTo(-40, 256);
  ctx.lineTo(120, 0);
  ctx.lineTo(190, 0);
  ctx.lineTo(30, 256);
  ctx.closePath();
  ctx.fill();

  /* two narrower highlights */
  const narrow = ctx.createLinearGradient(330, 0, 430, 256);
  narrow.addColorStop(0, "rgba(255,255,255,0)");
  narrow.addColorStop(0.5, "rgba(220,250,255,0.10)");
  narrow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = narrow;
  ctx.beginPath();
  ctx.moveTo(320, 256);
  ctx.lineTo(410, 0);
  ctx.lineTo(430, 0);
  ctx.lineTo(340, 256);
  ctx.closePath();
  ctx.fill();

  /* faint fingerprints / haze near the edges */
  for (let i = 0; i < 26; i++) {
    const x = rand(0, 512);
    const y = rand(0, 256);
    const r = rand(8, 42);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(230,250,255,0.05)");
    g.addColorStop(1, "rgba(230,250,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  return canvasTexture(c, 1, 1);
}

/* ---------------------------------------------------------
   Sand
   --------------------------------------------------------- */

function buildSand() {
  const geometry = new THREE.PlaneGeometry(TANK.w - 0.06, TANK.d - 0.06, 190, 96);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const edge = 1 - Math.min(1, Math.abs(z) / (TANK.d / 2)) * 0.35;
    const y =
      Math.sin(x * 1.5 + 0.6) * 0.03 +
      Math.cos(z * 2.1) * 0.026 +
      Math.sin((x + z) * 3.4) * 0.012 +
      Math.sin(x * 0.6) * 0.026 * edge +
      (fbm(x * 0.55 + 3.1, z * 0.55 + 1.7, 4, 8) - 0.5) * 0.05;
    pos.setY(i, y);
  }
  geometry.computeVertexNormals();

  const texture = makeSandTexture();
  const normalMap = makeSandNormalTexture();
  normalMap.repeat.set(6, 4);

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.93,
    metalness: 0,
    color: 0xb5a07c,
  });

  sandMesh = new THREE.Mesh(geometry, material);
  sandMesh.position.y = TANK.sandY;
  sandMesh.receiveShadow = true;
  scene.add(sandMesh);

  /* scattered rounded pebbles, with per-instance colour variation */
  const pebbleGeometry = new THREE.IcosahedronGeometry(1, 2);
  const pebbleMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0.04,
    vertexColors: false,
  });
  const pebbleCount = 280;
  const pebbles = new THREE.InstancedMesh(pebbleGeometry, pebbleMaterial, pebbleCount);
  const dummy = new THREE.Object3D();
  const pebbleColor = new THREE.Color();
  const pebblePalette = [0x9c8d74, 0x7f7568, 0xb9a98b, 0x6c655c, 0xc7b79a, 0x8a7a68];

  for (let i = 0; i < pebbleCount; i++) {
    const s = rand(0.02, 0.075);
    dummy.position.set(rand(-4.75, 4.75), TANK.sandY + rand(-0.005, 0.025), rand(-2.35, 2.35));
    dummy.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
    dummy.scale.set(s * rand(0.85, 1.35), s * rand(0.45, 0.7), s * rand(0.85, 1.35));
    dummy.updateMatrix();
    pebbles.setMatrixAt(i, dummy.matrix);

    pebbleColor.setHex(pebblePalette[(Math.random() * pebblePalette.length) | 0]);
    pebbleColor.offsetHSL(0, rand(-0.05, 0.05), rand(-0.08, 0.08));
    pebbles.setColorAt(i, pebbleColor);
  }
  pebbles.instanceMatrix.needsUpdate = true;
  pebbles.instanceColor.needsUpdate = true;
  pebbles.receiveShadow = true;
  pebbles.castShadow = true;
  scene.add(pebbles);

  /* a handful of bigger, half-buried stones */
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: 0x5a544b,
    roughness: 0.88,
    metalness: 0.04,
  });

  for (let i = 0; i < 12; i++) {
    const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), stoneMaterial);
    const s = rand(0.1, 0.26);
    stone.scale.set(s * rand(1, 1.6), s * rand(0.4, 0.7), s * rand(1, 1.5));
    stone.position.set(
      rand(-4.5, 4.5),
      TANK.sandY + stone.scale.y * 0.32,
      rand(-2.2, 2.2)
    );
    stone.rotation.set(rand(-0.1, 0.1), rand(0, Math.PI), rand(-0.08, 0.08));
    stone.castShadow = true;
    stone.receiveShadow = true;
    scene.add(stone);
  }
}

function makeSandTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#c0aa84";
  ctx.fillRect(0, 0, 512, 512);

  /* broad colour blotches */
  for (let i = 0; i < 110; i++) {
    const x = rand(0, 512);
    const y = rand(0, 512);
    const r = rand(12, 70);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = palettePick(["150, 128, 92", "116, 100, 74", "176, 158, 124"]);
    g.addColorStop(0, `rgba(${tone}, ${rand(0.05, 0.14).toFixed(3)})`);
    g.addColorStop(1, `rgba(${tone}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* wind/water ripples */
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 46; i++) {
    const y = rand(0, 512);
    ctx.strokeStyle = i % 2 ? "#9a825c" : "#e0d2b2";
    ctx.lineWidth = rand(0.8, 2.6);
    ctx.beginPath();
    for (let x = -10; x <= 522; x += 8) {
      const yy = y + Math.sin(x * 0.045 + i) * 5;
      if (x === -10) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* grain */
  const palette = ["#ddcdaa", "#8b7553", "#6d5a3d", "#efe4cd", "#a58c64", "#5c4b34"];
  for (let i = 0; i < 26000; i++) {
    ctx.fillStyle = palette[(Math.random() * palette.length) | 0];
    ctx.globalAlpha = rand(0.12, 0.6);
    const size = rand(0.5, 2.2);
    ctx.fillRect(rand(0, 512), rand(0, 512), size, size);
  }
  ctx.globalAlpha = 1;

  /* occasional shell / brighter grains */
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = "rgba(255, 250, 235, 0.7)";
    ctx.beginPath();
    ctx.arc(rand(0, 512), rand(0, 512), rand(0.6, 1.6), 0, Math.PI * 2);
    ctx.fill();
  }

  return canvasTexture(c, 3, 2);
}

function palettePick(list) {
  return list[(Math.random() * list.length) | 0];
}

function makeSandNormalTexture() {
  const ripple = (u, v) => {
    const n = fbm(u * 7, v * 7, 4, 7);
    return (
      0.55 +
      Math.sin((u * 26 + n * 2.4) * Math.PI * 2) * 0.16 +
      Math.sin((v * 30 + n * 1.8) * Math.PI * 2) * 0.12 +
      fbm(u * 22, v * 22, 3, 22) * 0.2
    );
  };
  return makeNormalTexture(256, ripple, 2.4);
}

/* ---------------------------------------------------------
   Rocks
   --------------------------------------------------------- */

function buildRocks() {
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.03,
    vertexColors: true,
  });

  const shadowTexture = makeRadialTexture(
    "rgba(0, 0, 0, 0.55)",
    "rgba(0, 0, 0, 0)"
  );
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });

  const spots = [
    [-3.9, -1.55, 1.15, 0.62],
    [-2.6, -1.75, 0.7, 0.48],
    [-0.9, -1.8, 0.55, 0.42],
    [1.4, -1.72, 0.8, 0.5],
    [3.3, -1.5, 1.0, 0.58],
    [4.0, -1.9, 0.55, 0.4],
    [-4.1, 0.1, 0.5, 0.36],
    [2.2, 0.6, 0.34, 0.3],
  ];

  spots.forEach(([x, z, scale]) => {
    const geometry = new THREE.IcosahedronGeometry(1, 4);
    const pos = geometry.attributes.position;
    const colors = [];
    const seed = Math.random() * 40;
    const seed2 = Math.random() * 40;

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);

      /* irregular, eroded silhouette */
      const n =
        1 +
        Math.sin(vx * 2.7 + seed) * 0.08 +
        Math.cos(vy * 3.1 + seed * 0.7) * 0.07 +
        Math.sin(vz * 2.2 + seed * 1.3) * 0.06 +
        (fbm(vx * 2.2 + seed, vz * 2.2 + seed2, 4, 8) - 0.5) * 0.26 +
        (fbm(vy * 3.4 + seed2, vx * 3.4, 3, 8) - 0.5) * 0.1;

      /* flatten the underside so it sits in the sand */
      let ny = vy * n;
      if (ny < -0.55) ny = -0.55 + (ny + 0.55) * 0.25;

      pos.setXYZ(i, vx * n, ny, vz * n);

      /* colour: stone with warm grains, algae and moss near the base */
      const grain = fbm(vx * 5 + seed2, vz * 5 + seed, 3, 16);
      const base = 0.17 + grain * 0.13;
      const moss = smoothstep(0.15, -0.55, vy) * rand(0.35, 0.75);
      const warm = smoothstep(0.4, 0.9, fbm(vx * 1.6, vy * 1.6, 2, 4));

      const r = base * (1 - moss * 0.55) + warm * 0.07;
      const g = base * (1 - moss * 0.2) + moss * 0.16 + warm * 0.05;
      const b = base * (1 - moss * 0.65) + warm * 0.02;
      colors.push(r, g, b);
    }

    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, rockMaterial);
    mesh.scale.set(scale, scale * rand(0.5, 0.75), scale * rand(0.7, 1));
    mesh.position.set(x, TANK.sandY + mesh.scale.y * 0.3, z);
    mesh.rotation.set(rand(0, 0.4), rand(0, Math.PI), rand(0, 0.25));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    /* contact shadow so the rock feels planted in the substrate */
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(scale * 2.6, scale * 1.9),
      shadowMaterial
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.rotation.z = rand(0, Math.PI);
    shadow.position.set(x, TANK.sandY + 0.012, z);
    shadow.renderOrder = 1;
    scene.add(shadow);
  });
}

/* ---------------------------------------------------------
   Plants
   --------------------------------------------------------- */

function makeBladeGeometry() {
  const segments = 11;
  const vertices = [];
  const indices = [];
  const uvs = [];
  const colors = [];
  const twist = 0.35;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    /* narrow at the root, widest around the middle, pointed tip */
    const width = 0.05 * (1 - Math.pow(t, 1.6)) * (0.55 + Math.sin(t * Math.PI) * 0.6);
    const halfWidth = Math.max(width, 0.0025);
    const bend = Math.pow(t, 2) * 0.26 + Math.pow(t, 4) * 0.1;
    const ridge = Math.sin(t * Math.PI) * 0.018;
    const tw = Math.sin(t * 2.2) * twist * 0.06;

    vertices.push(bend - halfWidth, t, ridge + tw);
    vertices.push(bend, t, ridge - 0.012);
    vertices.push(bend + halfWidth, t, ridge - tw);
    uvs.push(0, t, 0.5, t, 1, t);

    /* darker at the base, brighter toward the tip */
    const shade = 0.28 + Math.pow(t, 0.7) * 0.72;
    colors.push(shade * 0.85, shade, shade * 0.82);
    colors.push(shade * 0.9, shade, shade * 0.86);
    colors.push(shade * 0.85, shade, shade * 0.82);
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 3;
    const b = a + 3;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
    indices.push(a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildPlants() {
  const blade = makeBladeGeometry();
  const GRASS_COUNT = 2600;
  const grass = new THREE.InstancedMesh(
    blade,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.52,
      metalness: 0,
      side: THREE.DoubleSide,
      roughness: 0.58,
    }),
    GRASS_COUNT
  );

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let index = 0;

  /* clusters: back wall, sides, a few foreground accents */
  const clusters = [];
  for (let i = 0; i < 11; i++) {
    clusters.push({
      x: rand(-4.45, 4.45),
      z: rand(-2.2, -1.3),
      n: 110,
      spread: rand(0.28, 0.65),
    });
  }
  for (let i = 0; i < 5; i++) {
    clusters.push({ x: rand(-4.5, -3.3), z: rand(-0.9, 1.8), n: 60, spread: 0.32 });
    clusters.push({ x: rand(3.3, 4.5), z: rand(-0.9, 1.8), n: 60, spread: 0.32 });
  }
  clusters.push({ x: rand(-2.6, -1.2), z: rand(1.7, 2.15), n: 46, spread: 0.28 });
  clusters.push({ x: rand(1.0, 2.5), z: rand(1.7, 2.15), n: 46, spread: 0.28 });
  clusters.push({ x: rand(-0.8, 0.6), z: rand(-0.4, 0.4), n: 26, spread: 0.35 });

  for (const cluster of clusters) {
    for (let i = 0; i < cluster.n && index < GRASS_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * cluster.spread;
      const height = rand(0.32, 1.95);

      dummy.position.set(
        cluster.x + Math.cos(a) * r,
        TANK.sandY - 0.02,
        cluster.z + Math.sin(a) * r
      );
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      /* thin young shoots and wide mature blades */
      dummy.scale.set(rand(0.65, 1.45) * (1.15 - height * 0.18), height, 1);
      dummy.updateMatrix();
      grass.setMatrixAt(index, dummy.matrix);

      const yellow = Math.random() < 0.18;
      color.setHSL(
        yellow ? rand(0.18, 0.24) : rand(0.27, 0.36),
        rand(0.38, 0.7),
        rand(0.12, 0.3)
      );
      grass.setColorAt(index, color);
      index++;
    }
  }

  grass.count = index;
  grass.instanceMatrix.needsUpdate = true;
  grass.instanceColor.needsUpdate = true;
  grass.receiveShadow = true;
  grass.frustumCulled = false;

  /* Sway shader */
  grassMaterial = grass.material;
  grassMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    grassUniform = shader.uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uTime;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float phase = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 1.3;
         float bendAmt = pow(max(position.y, 0.0), 2.0);
         transformed.x += sin(uTime * 1.15 + phase) * 0.11 * bendAmt;
         transformed.z += cos(uTime * 0.85 + phase * 1.4) * 0.07 * bendAmt;
         transformed.y -= sin(uTime * 0.9 + phase) * 0.012 * bendAmt;`
      );
  };
  grassMaterial.customProgramCacheKey = () => "aquarium-grass";

  scene.add(grass);

  /* -------------------------------------------------------
     Broad-leaf aquarium plants (Amazon sword style)
     ------------------------------------------------------- */

  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.bezierCurveTo(0.16, 0.18, 0.24, 0.55, 0.16, 0.88);
  leafShape.bezierCurveTo(0.1, 1.12, 0.03, 1.24, 0, 1.34);
  leafShape.bezierCurveTo(-0.03, 1.24, -0.1, 1.12, -0.16, 0.88);
  leafShape.bezierCurveTo(-0.24, 0.55, -0.16, 0.18, 0, 0);

  const leafGeometry = new THREE.ShapeGeometry(leafShape, 20);
  /* gentle curl along the length and a slight fold along the midrib */
  const lp = leafGeometry.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const y = lp.getY(i);
    const x = lp.getX(i);
    lp.setZ(i, Math.pow(y / 1.34, 2.2) * 0.42 - Math.abs(x) * 0.35);
  }
  leafGeometry.computeVertexNormals();
  normalizeUV(leafGeometry);

  const leafTextures = [makeLeafTexture("#3f8f4d", "#1d4a28"), makeLeafTexture("#7fae4e", "#2f5c26")];
  const redTextures = [makeLeafTexture("#b4473a", "#5c1f22"), makeLeafTexture("#c9773f", "#6b2f1c")];

  const greenMaterials = leafTextures.map(
    (map) =>
      new THREE.MeshStandardMaterial({
        map,
        roughness: 0.48,
        metalness: 0.02,
        side: THREE.DoubleSide,
        emissive: 0x051409,
        emissiveIntensity: 0.5,
      })
  );
  const redMaterials = redTextures.map(
    (map) =>
      new THREE.MeshStandardMaterial({
        map,
        roughness: 0.5,
        metalness: 0.02,
        side: THREE.DoubleSide,
        emissive: 0x150604,
        emissiveIntensity: 0.5,
      })
  );

  const stemMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d5a30,
    roughness: 0.62,
  });

  const positions = [
    [-4.0, -1.2, false],
    [-2.2, -1.75, false],
    [0.8, -1.85, false],
    [2.6, -1.55, false],
    [4.05, -0.9, false],
    [-3.4, 1.5, false],
    [-1.3, -1.5, true],
    [3.5, 0.9, true],
  ];

  positions.forEach(([x, z, red]) => {
    const group = new THREE.Group();
    group.position.set(x, TANK.sandY, z);
    group.rotation.y = rand(0, Math.PI * 2);

    const materials = red ? redMaterials : greenMaterials;
    const stemHeight = rand(0.18, 0.5);

    if (!red) {
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.022, stemHeight, 6),
        stemMaterial
      );
      stem.position.y = stemHeight * 0.5;
      stem.castShadow = true;
      group.add(stem);
    }

    const leaves = red ? 18 + ((Math.random() * 8) | 0) : 9 + ((Math.random() * 5) | 0);
    const spreadRadius = red ? rand(0.18, 0.3) : rand(0.02, 0.1);

    for (let l = 0; l < leaves; l++) {
      const mesh = new THREE.Mesh(
        leafGeometry,
        materials[l % materials.length]
      );
      const angle = (l / leaves) * Math.PI * 2 + rand(-0.35, 0.35);
      const tilt = red ? rand(0.25, 0.9) : rand(0.5, 1.05);
      const s = red ? rand(0.28, 0.55) : rand(0.65, 1.3);

      const startY = red ? rand(0.15, 0.95) : stemHeight * 0.85;

      mesh.position.set(
        Math.cos(angle) * spreadRadius,
        startY,
        Math.sin(angle) * spreadRadius
      );
      mesh.rotation.set(0, angle, 0);
      mesh.rotateX(-tilt);

      mesh.scale.set(s, s * rand(0.85, 1.15), s);
      mesh.castShadow = true;
      group.add(mesh);
    }

    group.userData.phase = rand(0, Math.PI * 2);
    group.userData.baseX = 0;
    group.userData.baseZ = 0;
    plantGroups.push(group);
    scene.add(group);
  });
}

function makeLeafTexture(light, dark) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, dark);
  g.addColorStop(0.55, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 256);

  /* midrib */
  ctx.strokeStyle = "rgba(220, 240, 200, 0.28)";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(64, 6);
  ctx.lineTo(64, 250);
  ctx.stroke();

  /* lateral veins */
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(210, 235, 190, 0.16)";
  for (let y = 18; y < 244; y += 12) {
    const spread = 20 + Math.sin((y / 256) * Math.PI) * 26;
    ctx.beginPath();
    ctx.moveTo(64, y);
    ctx.quadraticCurveTo(64 + spread * 0.6, y + 7, 64 + spread, y + 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(64, y);
    ctx.quadraticCurveTo(64 - spread * 0.6, y + 7, 64 - spread, y + 12);
    ctx.stroke();
  }

  /* subtle blotches */
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255, 255, 230, ${rand(0.01, 0.05).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(rand(10, 118), rand(10, 246), rand(2, 9), rand(3, 14), rand(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/* ---------------------------------------------------------
   Water surface & caustics
   --------------------------------------------------------- */

function buildWaterSurface() {
  causticTexture = makeCausticTexture();

  waterBump = causticTexture.clone();
  waterBump.needsUpdate = true;
  waterBump.wrapS = waterBump.wrapT = THREE.RepeatWrapping;
  waterBump.repeat.set(1.8, 1.4);

  const surfaceGeometry = new THREE.PlaneGeometry(TANK.w - 0.06, TANK.d - 0.06, 52, 34);

  waterSurface = new THREE.Mesh(
    surfaceGeometry,
    new THREE.MeshPhysicalMaterial({
      color: 0x9fe0ea,
      metalness: 0,
      roughness: 0.045,
      transparent: true,
      opacity: 0.13,
      envMapIntensity: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      ior: 1.33,
      side: THREE.DoubleSide,
      depthWrite: false,
      bumpMap: waterBump,
      bumpScale: 0.4,
    })
  );
  waterSurface.userData.basePositions = surfaceGeometry.attributes.position.array.slice();
  waterSurface.userData.frame = 0;
  waterSurface.rotation.x = -Math.PI / 2;
  waterSurface.position.y = TANK.waterY;
  waterSurface.renderOrder = 6;
  scene.add(waterSurface);
}

function buildCaustics() {
  const baseMaterial = new THREE.MeshBasicMaterial({
    map: causticTexture,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    color: 0xa8ecff,
  });

  const layer1 = new THREE.Mesh(
    new THREE.PlaneGeometry(TANK.w - 0.1, TANK.d - 0.1),
    baseMaterial
  );
  layer1.rotation.x = -Math.PI / 2;
  layer1.position.y = TANK.sandY + 0.06;
  layer1.renderOrder = 1;
  scene.add(layer1);

  const texture2 = causticTexture.clone();
  texture2.needsUpdate = true;
  texture2.wrapS = texture2.wrapT = THREE.RepeatWrapping;
  texture2.repeat.set(1.3, 1.7);
  texture2.rotation = 0.8;

  const layer2 = new THREE.Mesh(
    new THREE.PlaneGeometry(TANK.w - 0.1, TANK.d - 0.1),
    new THREE.MeshBasicMaterial({
      map: texture2,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: 0x74d5ea,
    })
  );
  layer2.rotation.x = -Math.PI / 2;
  layer2.position.y = TANK.sandY + 0.055;
  layer2.renderOrder = 1;
  scene.add(layer2);

  waterSurface.userData.surfaceTexture = waterBump;
  waterSurface.userData.layer2 = layer2;
}

function makeCausticTexture(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const image = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;

      const a = Math.sin(u * 3 + Math.sin(v * 2) * 2.0);
      const b = Math.sin(v * 3 + Math.sin(u * 2.4) * 2.2);
      const d = Math.sin((u + v) * 2.1);

      const n = Math.abs((a + b + d) / 3);
      let value = Math.pow(1 - n, 7) * 1.8;
      value = Math.min(1, value);

      const i = (y * size + x) * 4;
      image.data[i] = 255 * value;
      image.data[i + 1] = 255 * value;
      image.data[i + 2] = 255 * value;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.6, 1.3);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ---------------------------------------------------------
   Fish textures
   --------------------------------------------------------- */

const fishTextureCache = {};

function getFishTexture(kind) {
  if (fishTextureCache[kind]) return fishTextureCache[kind];

  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");

  if (kind === "clown") {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#ff9a3d");
    g.addColorStop(0.45, "#ff6f1d");
    g.addColorStop(1, "#e5510e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);

    drawBand(ctx, 58, 88, 5, "#fdf6ea");
    drawBand(ctx, 124, 152, 6, "#fdf6ea");
    drawBand(ctx, 188, 212, 4, "#fdf6ea");

    /* dark edging */
    ctx.strokeStyle = "rgba(90, 25, 5, 0.35)";
    ctx.lineWidth = 2;
    [73, 138, 200].forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= 256; x += 8) {
        ctx.lineTo(x, y + Math.sin(x * 0.06) * 4);
      }
      ctx.stroke();
    });
  } else if (kind === "tang") {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#3d6bff");
    g.addColorStop(0.55, "#1d3fce");
    g.addColorStop(1, "#0b1e7a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);

    ctx.fillStyle = "#071338";
    ctx.beginPath();
    ctx.moveTo(40, 92);
    ctx.bezierCurveTo(90, 60, 165, 70, 218, 112);
    ctx.bezierCurveTo(232, 140, 205, 180, 160, 186);
    ctx.bezierCurveTo(105, 194, 55, 160, 40, 128);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(255, 220, 90, 0.22)";
    ctx.fillRect(0, 214, 256, 26);
  } else if (kind === "tetra") {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#b8f2ff");
    g.addColorStop(0.35, "#7fd8ee");
    g.addColorStop(0.62, "#d9f8ff");
    g.addColorStop(1, "#5fb7cf");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);

    ctx.fillStyle = "#ff3b4e";
    ctx.fillRect(0, 176, 256, 26);
    ctx.fillStyle = "rgba(20, 60, 90, 0.45)";
    ctx.fillRect(0, 205, 256, 10);
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.fillRect(0, 168, 256, 6);
  } else {
    /* angelfish */
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#f0f4f7");
    g.addColorStop(0.5, "#cdd6dd");
    g.addColorStop(1, "#9eaab4");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);

    [44, 118, 196].forEach((x, i) => {
      ctx.fillStyle = "rgba(20, 28, 34, 0.8)";
      ctx.beginPath();
      ctx.ellipse(x + 20, 128, 20 + i * 3, 128, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "rgba(255, 235, 180, 0.25)";
    ctx.fillRect(0, 110, 256, 30);
  }

  drawFishDetails(ctx, kind);

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  fishTextureCache[kind] = texture;
  return texture;
}

function drawFishDetails(ctx, kind) {
  /* overlapping scale pattern */
  ctx.lineWidth = 0.9;
  for (let row = 0; row < 26; row++) {
    const y = row * 10 + 4;
    const offset = (row % 2) * 5;
    for (let x = -6; x < 256; x += 10) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.055)";
      ctx.beginPath();
      ctx.arc(x + offset, y, 5.2, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.035)";
      ctx.beginPath();
      ctx.arc(x + offset, y + 0.8, 5.2, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
    }
  }

  /* gill cover: a soft vertical crease behind the head */
  const gillY = kind === "angel" ? 112 : 104;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, gillY);
  ctx.bezierCurveTo(80, gillY - 7, 176, gillY - 7, 256, gillY);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, gillY + 3);
  ctx.bezierCurveTo(80, gillY - 4, 176, gillY - 4, 256, gillY + 3);
  ctx.stroke();

  /* subtle sheen band along the flank */
  const sheen = ctx.createLinearGradient(0, 140, 0, 190);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.10)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 140, 256, 50);
}

function drawBand(ctx, y0, y1, amplitude, color) {
  const phase = Math.random() * 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, y0);
  for (let x = 0; x <= 256; x += 6) {
    ctx.lineTo(x, y0 + Math.sin(x * 0.055 + phase) * amplitude);
  }
  for (let x = 256; x >= 0; x -= 6) {
    ctx.lineTo(x, y1 + Math.sin(x * 0.055 + phase) * amplitude);
  }
  ctx.closePath();
  ctx.fill();
}

/* ---------------------------------------------------------
   Fish geometry
   --------------------------------------------------------- */

const bodyGeometry = (() => {
  const profile = [
    [0.02, -1.0],
    [0.09, -0.92],
    [0.17, -0.78],
    [0.25, -0.6],
    [0.32, -0.37],
    [0.37, -0.11],
    [0.385, 0.17],
    [0.365, 0.43],
    [0.31, 0.65],
    [0.23, 0.83],
    [0.12, 0.95],
    [0.012, 1.0],
  ].map((p) => new THREE.Vector2(p[0], p[1]));

  const geometry = new THREE.LatheGeometry(profile, 44);
  geometry.rotateX(Math.PI / 2);
  geometry.scale(0.62, 1, 1);
  geometry.computeVertexNormals();
  return geometry;
})();

function makeTailGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.26);
  shape.quadraticCurveTo(-0.3, 0.55, -0.64, 0.66);
  shape.quadraticCurveTo(-0.48, 0.26, -0.46, 0);
  shape.quadraticCurveTo(-0.48, -0.26, -0.64, -0.66);
  shape.quadraticCurveTo(-0.3, -0.55, 0, -0.26);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape, 16);
  normalizeUV(geometry);
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

function makeDorsalGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.42, 0);
  shape.quadraticCurveTo(0.28, 0.32, 0.02, 0.38);
  shape.quadraticCurveTo(-0.22, 0.36, -0.32, 0.24);
  shape.quadraticCurveTo(-0.4, 0.14, -0.5, 0);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape, 14);
  normalizeUV(geometry);
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

function makeAnalGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.1, 0);
  shape.quadraticCurveTo(-0.02, -0.28, -0.3, -0.34);
  shape.quadraticCurveTo(-0.36, -0.16, -0.48, 0);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape, 12);
  normalizeUV(geometry);
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

function makePectoralGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(-0.12, 0.18, -0.34, 0.22);
  shape.quadraticCurveTo(-0.26, 0.04, -0.36, -0.11);
  shape.quadraticCurveTo(-0.15, -0.08, 0, 0);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 12);
  normalizeUV(geometry);
  return geometry;
}

function makePelvicGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(-0.06, -0.18, -0.22, -0.26);
  shape.quadraticCurveTo(-0.19, -0.1, -0.26, 0.02);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 10);
  normalizeUV(geometry);
  return geometry;
}

const tailGeometry = makeTailGeometry();
const dorsalGeometry = makeDorsalGeometry();
const analGeometry = makeAnalGeometry();
const pectoralGeometry = makePectoralGeometry();
const pelvicGeometry = makePelvicGeometry();

const irisGeometry = new THREE.SphereGeometry(0.06, 14, 12);
const pupilGeometry = new THREE.SphereGeometry(0.042, 12, 10);
const glintGeometry = new THREE.SphereGeometry(0.016, 8, 6);
const irisMaterial = new THREE.MeshStandardMaterial({
  color: 0xc79a3a,
  roughness: 0.22,
  metalness: 0.55,
});
const pupilMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x05070a,
  roughness: 0.08,
  metalness: 0.2,
  clearcoat: 1,
});
const glintMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

const mouthGeometry = new THREE.SphereGeometry(0.05, 10, 8);
const mouthMaterial = new THREE.MeshStandardMaterial({
  color: 0x3a1612,
  roughness: 0.6,
});

const species = [
  { kind: "clown", count: 2, size: 0.58, tailColor: 0xff9a4a, wiggle: [5, 7], finScale: 1 },
  { kind: "tang", count: 2, size: 0.62, tailColor: 0xffd23f, wiggle: [4, 6], finScale: 1.1 },
  { kind: "tetra", count: 9, size: 0.31, tailColor: 0xcdefff, wiggle: [8, 11], finScale: 0.9 },
  { kind: "angel", count: 1, size: 0.64, tailColor: 0xdbe2ff, wiggle: [3.5, 5], tall: true, finScale: 1.5 },
];

const finTextureCache = {};

function getFinTexture(kind, color) {
  if (finTextureCache[kind]) return finTextureCache[kind];

  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const hex = "#" + color.toString(16).padStart(6, "0");

  ctx.clearRect(0, 0, 256, 256);

  /* root at the right edge, membrane fading toward the tips */
  const g = ctx.createRadialGradient(252, 128, 6, 252, 128, 250);
  g.addColorStop(0, hexToRgba(hex, 0.95));
  g.addColorStop(0.55, hexToRgba(hex, 0.62));
  g.addColorStop(1, hexToRgba(hex, 0.34));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);

  /* fin rays */
  for (let i = 0; i < 26; i++) {
    const spread = (i / 25 - 0.5) * 2;
    const endX = 252 - 240 + Math.abs(spread) * 26;
    const endY = 128 + spread * 124;
    ctx.strokeStyle = "rgba(15, 25, 30, 0.16)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(250, 128);
    ctx.quadraticCurveTo(170, 128 + spread * 40, endX, endY);
    ctx.stroke();
  }

  /* soft edge / translucency */
  ctx.globalCompositeOperation = "destination-in";
  const fade = ctx.createRadialGradient(252, 128, 40, 252, 128, 252);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(0.7, "rgba(0,0,0,0.85)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  finTextureCache[kind] = texture;
  return texture;
}

function hexToRgba(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const finMaterialCache = {};

function getFinMaterial(kind, color) {
  if (finMaterialCache[kind]) return finMaterialCache[kind];
  const material = new THREE.MeshPhysicalMaterial({
    map: getFinTexture(kind, color),
    color: 0xffffff,
    transparent: true,
    opacity: 0.96,
    alphaTest: 0.02,
    depthWrite: false,
    roughness: 0.3,
    metalness: 0.05,
    side: THREE.DoubleSide,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.65,
    sheen: 0.12,
    sheenColor: new THREE.Color(0x8fc8da),
    sheenRoughness: 0.6,
  });
  finMaterialCache[kind] = material;
  return material;
}

const scaleNormalMap = makeNormalTexture(
  128,
  (u, v) => 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 16) * Math.cos(v * Math.PI * 2 * 11),
  1.1
);
scaleNormalMap.repeat.set(3.5, 2.2);

const bodyMaterialCache = {};

function getBodyMaterial(kind) {
  if (bodyMaterialCache[kind]) return bodyMaterialCache[kind];
  const material = new THREE.MeshPhysicalMaterial({
    map: getFishTexture(kind),
    normalMap: kind === "tetra" ? null : scaleNormalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.38,
    metalness: 0.04,
    clearcoat: 0.55,
    clearcoatRoughness: 0.32,
    iridescence: kind === "tetra" ? 0.85 : 0.3,
    iridescenceIOR: 1.45,
    iridescenceThicknessRange: [120, 420],
    sheen: kind === "angel" || kind === "tetra" ? 0.35 : 0.12,
    sheenColor: new THREE.Color(0x93cadd),
    sheenRoughness: 0.55,
    envMapIntensity: 0.55,
  });
  bodyMaterialCache[kind] = material;
  return material;
}

/* ---------------------------------------------------------
   Fish paths
   --------------------------------------------------------- */

function makeLoop(radiusX, radiusZ, centerY, ampY) {
  const points = [];
  const count = 7;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const rx = radiusX * rand(0.72, 1.05);
    const rz = radiusZ * rand(0.7, 1.05);

    points.push(
      new THREE.Vector3(
        THREE.MathUtils.clamp(Math.cos(angle) * rx, -4.05, 4.05),
        THREE.MathUtils.clamp(
          centerY + Math.sin(angle * 2 + 1) * ampY + rand(-0.25, 0.25),
          -1.55,
          1.5
        ),
        THREE.MathUtils.clamp(Math.sin(angle) * rz, -1.6, 1.6)
      )
    );
  }

  return new THREE.CatmullRomCurve3(points, true, "centripetal", 0.5);
}

/* ---------------------------------------------------------
   Fish
   --------------------------------------------------------- */

function buildFish() {
  const schoolCurve = makeLoop(2.6, 0.9, 0.1, 0.55);
  let globalIndex = 0;

  species.forEach((spec) => {
    for (let i = 0; i < spec.count; i++) {
      const fish = createFish(spec, globalIndex, schoolCurve);
      fishes.push(fish);
      globalIndex++;
    }
  });
}

function createFish(spec, index, schoolCurve) {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const bodyMaterial = getBodyMaterial(spec.kind);
  const finMaterial = getFinMaterial(spec.kind, spec.tailColor);

  const finScale = spec.finScale ?? 1;

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.scale.set(
    spec.tall ? 0.92 : 1,
    spec.tall ? 1.32 : 1,
    spec.kind === "tetra" ? 1.04 : 1
  );
  body.castShadow = true;
  bodyPivot.add(body);

  /* Tail */
  const tailPivot = new THREE.Group();
  tailPivot.position.z = -0.985;
  const tail = new THREE.Mesh(tailGeometry, finMaterial);
  tail.scale.set(
    spec.tall ? 1.5 : spec.kind === "clown" ? 1.1 : 1,
    spec.tall ? 1.55 : spec.kind === "clown" ? 1.08 : 1,
    1
  );
  tailPivot.add(tail);
  bodyPivot.add(tailPivot);

  /* Dorsal */
  const dorsal = new THREE.Mesh(dorsalGeometry, finMaterial);
  dorsal.position.set(0, spec.tall ? 0.34 : 0.29, spec.tall ? -0.05 : 0.02);
  dorsal.scale.set(
    (spec.tall ? 1.45 : 1) * finScale,
    (spec.tall ? 1.75 : 1) * finScale,
    1
  );
  bodyPivot.add(dorsal);

  /* Anal fin */
  const anal = new THREE.Mesh(analGeometry, finMaterial);
  anal.position.set(0, spec.tall ? -0.3 : -0.25, spec.tall ? -0.12 : -0.2);
  anal.scale.set(
    (spec.tall ? 1.5 : 1) * finScale,
    (spec.tall ? 1.9 : 1) * finScale,
    1
  );
  bodyPivot.add(anal);

  /* Pectoral fins */
  const pectoralL = new THREE.Mesh(pectoralGeometry, finMaterial);
  pectoralL.position.set(0.24, -0.02, 0.32);
  pectoralL.rotation.set(0, 1.15, 0.25);
  pectoralL.scale.setScalar(finScale * 0.95);
  bodyPivot.add(pectoralL);

  const pectoralR = new THREE.Mesh(pectoralGeometry, finMaterial);
  pectoralR.position.set(-0.24, -0.02, 0.32);
  pectoralR.rotation.set(0, -1.15, -0.25);
  pectoralR.scale.setScalar(finScale * 0.95);
  bodyPivot.add(pectoralR);

  /* Pelvic fins, tucked under the belly */
  const pelvicL = new THREE.Mesh(pelvicGeometry, finMaterial);
  pelvicL.position.set(0.07, -0.18, 0.18);
  pelvicL.rotation.set(0, 0.2, -0.15);
  pelvicL.scale.setScalar(finScale * 0.8);
  bodyPivot.add(pelvicL);

  const pelvicR = new THREE.Mesh(pelvicGeometry, finMaterial);
  pelvicR.position.set(-0.07, -0.18, 0.18);
  pelvicR.rotation.set(0, -0.2, 0.15);
  pelvicR.scale.setScalar(finScale * 0.8);
  bodyPivot.add(pelvicR);

  /* Eyes: gold iris with a glossy pupil and a catchlight */
  for (const side of [-1, 1]) {
    const iris = new THREE.Mesh(irisGeometry, irisMaterial);
    iris.position.set(side * 0.15, 0.07, 0.7);
    iris.scale.set(1, 1, 0.55);
    bodyPivot.add(iris);

    const pupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
    pupil.position.set(side * 0.158, 0.07, 0.733);
    pupil.scale.set(1, 1, 0.5);
    bodyPivot.add(pupil);

    const glint = new THREE.Mesh(glintGeometry, glintMaterial);
    glint.position.set(side * 0.172, 0.088, 0.744);
    bodyPivot.add(glint);
  }

  /* Mouth */
  const mouth = new THREE.Mesh(mouthGeometry, mouthMaterial);
  mouth.position.set(0, -0.035, 0.975);
  mouth.scale.set(0.75, 0.5, 0.5);
  bodyPivot.add(mouth);

  /* Placement */
  const curve =
    spec.kind === "tetra"
      ? schoolCurve
      : makeLoop(rand(2.0, 3.2), rand(0.6, 1.15), rand(-0.4, 0.4), rand(0.35, 0.7));

  const u = Math.random();
  const point = curve.getPointAt(u);
  const offset = new THREE.Vector3(
    spec.kind === "tetra" ? rand(-0.25, 0.25) : 0,
    spec.kind === "tetra" ? rand(-0.12, 0.12) : 0,
    spec.kind === "tetra" ? rand(-0.18, 0.18) : 0
  );

  root.position.copy(point).add(offset);
  root.scale.setScalar(spec.size);

  const tangent = curve.getTangentAt(u);
  root.quaternion.copy(quaternionTowards(tangent));

  scene.add(root);

  return {
    root,
    bodyPivot,
    tailPivot,
    pectoralL,
    pectoralR,
    dorsal,
    curve,
    offset,
    u,
    speed: rand(0.032, 0.055),
    phase: rand(0, Math.PI * 2),
    wiggle: rand(spec.wiggle[0], spec.wiggle[1]),
    size: spec.size,
    kind: spec.kind,
    feedTarget: null,
    eatPulse: 0,
    tempDir: new THREE.Vector3(),
    tempQuat: new THREE.Quaternion(),
  };
}

/* ---------------------------------------------------------
   Bubbles & dust
   --------------------------------------------------------- */

let bubblePoints, bubbleData, bubblePositions;
let dustPoints;

function makeBubbleSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");

  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,0.06)");
  g.addColorStop(0.68, "rgba(220,250,255,0.1)");
  g.addColorStop(0.86, "rgba(230,255,255,0.8)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(23, 22, 4, 0, Math.PI * 2);
  ctx.fill();

  return canvasTexture(c, 1, 1);
}

function buildBubbles() {
  const count = 170;
  bubblePositions = new Float32Array(count * 3);
  bubbleData = [];

  for (let i = 0; i < count; i++) {
    const x = rand(-4.3, 4.3);
    const z = rand(-2.0, 2.0);
    const y = rand(TANK.sandY, TANK.waterY);

    bubblePositions[i * 3] = x;
    bubblePositions[i * 3 + 1] = y;
    bubblePositions[i * 3 + 2] = z;

    bubbleData.push({
      baseX: x,
      baseZ: z,
      speed: rand(0.18, 0.5),
      phase: rand(0, Math.PI * 2),
      wobble: rand(0.03, 0.09),
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(bubblePositions, 3));

  bubblePoints = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      map: makeBubbleSprite(),
      size: 0.22,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      sizeAttenuation: true,
      color: 0xd6f4ff,
    })
  );
  bubblePoints.frustumCulled = false;
  scene.add(bubblePoints);
}

function buildDust() {
  const count = 260;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = rand(-4.7, 4.7);
    positions[i * 3 + 1] = rand(TANK.sandY, TANK.waterY - 0.1);
    positions[i * 3 + 2] = rand(-2.3, 2.3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  dustPoints = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xbfe6ee,
      size: 0.035,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    })
  );
  dustPoints.frustumCulled = false;
  scene.add(dustPoints);
}

/* ---------------------------------------------------------
   Light shafts
   --------------------------------------------------------- */

function makeRayTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 512;
  const ctx = c.getContext("2d");

  const vertical = ctx.createLinearGradient(0, 0, 0, 512);
  vertical.addColorStop(0, "rgba(255,255,255,0.9)");
  vertical.addColorStop(0.35, "rgba(255,255,255,0.32)");
  vertical.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, 128, 512);

  ctx.globalCompositeOperation = "destination-in";
  const horizontal = ctx.createLinearGradient(0, 0, 128, 0);
  horizontal.addColorStop(0, "rgba(0,0,0,0)");
  horizontal.addColorStop(0.5, "rgba(0,0,0,1)");
  horizontal.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, 128, 512);

  return canvasTexture(c, 1, 1);
}

function buildLightRays() {
  const texture = makeRayTexture();

  for (let i = 0; i < 4; i++) {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: rand(0.05, 0.1),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: 0xbfefff,
      fog: false,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(rand(1.8, 3.2), 7.5), material);
    mesh.position.set(rand(-3.4, 3.4), 1.2, rand(-1.2, 1.2));
    mesh.rotation.z = rand(-0.18, 0.18);
    mesh.rotation.y = rand(-0.2, 0.2);
    mesh.userData.phase = rand(0, Math.PI * 2);
    mesh.userData.baseOpacity = material.opacity;
    mesh.renderOrder = 4;
    rays.push(mesh);
    scene.add(mesh);
  }
}

/* ---------------------------------------------------------
   Feeding
   --------------------------------------------------------- */

const pelletGeometry = new THREE.SphereGeometry(0.045, 8, 6);
const pelletMaterial = new THREE.MeshStandardMaterial({
  color: 0xffcf7a,
  roughness: 0.7,
  metalness: 0,
  emissive: 0x553311,
  emissiveIntensity: 0.4,
});

function feed(x, z) {
  const originX = THREE.MathUtils.clamp(x ?? rand(-2.8, 2.8), -3.8, 3.8);
  const originZ = THREE.MathUtils.clamp(z ?? rand(-1.1, 1.1), -1.5, 1.5);

  for (let i = 0; i < 12; i++) {
    if (pellets.length > 28) break;

    const mesh = new THREE.Mesh(pelletGeometry, pelletMaterial);
    mesh.position.set(
      originX + rand(-0.5, 0.5),
      TANK.waterY - 0.12,
      originZ + rand(-0.4, 0.4)
    );
    mesh.scale.setScalar(rand(0.7, 1.15));
    scene.add(mesh);

    pellets.push({
      mesh,
      speed: rand(0.22, 0.4),
      phase: rand(0, Math.PI * 2),
      dead: false,
    });
  }

  /* send fish after the nearest food */
  for (const fish of fishes) {
    let best = null;
    let bestDistance = Infinity;

    for (const pellet of pellets) {
      if (pellet.dead) continue;
      const d =
        fish.root.position.distanceToSquared(pellet.mesh.position) +
        Math.random() * 3;
      if (d < bestDistance) {
        bestDistance = d;
        best = pellet;
      }
    }

    if (best && Math.random() > 0.12) fish.feedTarget = best;
  }
}

function updatePellets(dt, time) {
  for (let i = pellets.length - 1; i >= 0; i--) {
    const pellet = pellets[i];
    if (pellet.dead) {
      pellets.splice(i, 1);
      continue;
    }

    pellet.mesh.position.y -= pellet.speed * dt;
    pellet.mesh.position.x += Math.sin(time * 1.6 + pellet.phase) * 0.04 * dt;
    pellet.mesh.rotation.x += dt * 0.8;
    pellet.mesh.rotation.z += dt * 0.5;

    if (pellet.mesh.position.y < TANK.sandY + 0.04) {
      scene.remove(pellet.mesh);
      pellet.dead = true;
      pellets.splice(i, 1);
    }
  }
}

function updateFish(dt, time) {
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const toTarget = new THREE.Vector3();

  for (const fish of fishes) {
    const target = fish.feedTarget;

    if (target && !target.dead) {
      toTarget.copy(target.mesh.position).sub(fish.root.position);
      const distance = toTarget.length();

      if (distance < 0.3) {
        target.dead = true;
        scene.remove(target.mesh);
        fish.feedTarget = null;
        fish.eatPulse = 1;
        fish.u = nearestU(fish.curve, fish.root.position) + 0.004;
      } else {
        toTarget.normalize();
        const speed = 1.9;
        fish.root.position.addScaledVector(toTarget, Math.min(speed * dt, distance));

        fish.tempQuat.copy(quaternionTowards(toTarget));
        fish.root.quaternion.slerp(fish.tempQuat, 1 - Math.exp(-dt * 7));
      }
    } else {
      if (target && target.dead) fish.feedTarget = null;

      fish.u = (fish.u + dt * fish.speed) % 1;
      fish.curve.getPointAt(fish.u, point);
      fish.curve.getTangentAt(fish.u, tangent);

      point.add(fish.offset);
      point.y += Math.sin(time * 1.1 + fish.phase) * 0.02;

      fish.root.position.lerp(point, 1 - Math.exp(-dt * 2.4));

      fish.tempQuat.copy(quaternionTowards(tangent));
      fish.root.quaternion.slerp(fish.tempQuat, 1 - Math.exp(-dt * 2.2));
    }

    /* keep everyone inside the glass */
    fish.root.position.x = THREE.MathUtils.clamp(fish.root.position.x, -4.45, 4.45);
    fish.root.position.y = THREE.MathUtils.clamp(fish.root.position.y, -1.75, 1.7);
    fish.root.position.z = THREE.MathUtils.clamp(fish.root.position.z, -1.9, 1.9);

    /* tail & fins */
    const wiggle = Math.sin(time * fish.wiggle + fish.phase);
    fish.tailPivot.rotation.y = wiggle * 0.55;
    fish.bodyPivot.rotation.y = wiggle * 0.045;
    /* gentle banking and bob, so the fish never looks like it is on rails */
    fish.bodyPivot.rotation.z = Math.sin(time * 0.75 + fish.phase) * 0.05;
    fish.bodyPivot.position.y = Math.sin(time * 1.4 + fish.phase * 1.7) * 0.025;
    fish.pectoralL.rotation.z = 0.25 + Math.sin(time * 3.2 + fish.phase) * 0.26;
    fish.pectoralR.rotation.z = -0.25 - Math.sin(time * 3.2 + fish.phase + 0.35) * 0.26;
    fish.bodyPivot.rotation.x = Math.sin(time * 1.1 + fish.phase) * 0.03;

    /* bite pulse */
    fish.eatPulse *= Math.exp(-dt * 5);
    fish.root.scale.setScalar(fish.size * (1 + fish.eatPulse * 0.16));
  }
}

function nearestU(curve, position) {
  let best = 0;
  let bestDistance = Infinity;
  const point = new THREE.Vector3();

  for (let i = 0; i < 90; i++) {
    const u = i / 90;
    curve.getPointAt(u, point);
    const d = point.distanceToSquared(position);
    if (d < bestDistance) {
      bestDistance = d;
      best = u;
    }
  }
  return best;
}

const lookMatrix = new THREE.Matrix4();
const negated = new THREE.Vector3();

function quaternionTowards(direction) {
  negated.copy(direction).negate();
  lookMatrix.lookAt(ORIGIN, negated, UP);
  return new THREE.Quaternion().setFromRotationMatrix(lookMatrix);
}

const ORIGIN = new THREE.Vector3(0, 0, 0);

/* ---------------------------------------------------------
   Per-frame updates
   --------------------------------------------------------- */

function updateBubbles(dt, time) {
  const positions = bubblePoints.geometry.attributes.position;

  for (let i = 0; i < bubbleData.length; i++) {
    const data = bubbleData[i];
    let y = bubblePositions[i * 3 + 1] + data.speed * dt;

    if (y > TANK.waterY - 0.02) {
      y = TANK.sandY + rand(0, 0.5);
      data.baseX = rand(-4.3, 4.3);
      data.baseZ = rand(-2.0, 2.0);
      data.phase = rand(0, Math.PI * 2);
    }

    bubblePositions[i * 3 + 1] = y;
    bubblePositions[i * 3] = data.baseX + Math.sin(time * 1.4 + data.phase) * data.wobble;
    bubblePositions[i * 3 + 2] = data.baseZ + Math.cos(time * 1.1 + data.phase) * data.wobble * 0.7;
  }

  positions.needsUpdate = true;
}

function updatePlants(time) {
  if (grassUniform) grassUniform.value = time;

  for (const group of plantGroups) {
    const p = group.userData.phase;
    group.rotation.z = Math.sin(time * 0.7 + p) * 0.025;
    group.rotation.x = Math.cos(time * 0.55 + p * 1.3) * 0.018;
  }
}

function updateWater(time) {
  if (waterBump) {
    waterBump.offset.x = time * 0.015;
    waterBump.offset.y = time * 0.01;
  }

  if (causticTexture) {
    causticTexture.offset.x = time * 0.016;
    causticTexture.offset.y = time * 0.011;
  }

  if (waterSurface?.userData.basePositions) {
    const ud = waterSurface.userData;
    const geometry = waterSurface.geometry;
    const positions = geometry.attributes.position;
    const array = positions.array;
    const base = ud.basePositions;

    for (let i = 0; i < positions.count; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      array[i * 3 + 2] =
        base[i * 3 + 2] +
        Math.sin(x * 1.6 + time * 1.1) * 0.018 +
        Math.cos(y * 2.1 + time * 0.85) * 0.014 +
        Math.sin((x + y) * 2.4 + time * 1.5) * 0.008;
    }
    positions.needsUpdate = true;

    ud.frame++;
    if (ud.frame % 2 === 0) geometry.computeVertexNormals();
  }

  if (waterSurface?.userData.layer2) {
    const layer2 = waterSurface.userData.layer2;
    layer2.material.map.offset.x = -time * 0.012;
    layer2.material.map.offset.y = time * 0.008;
    layer2.material.opacity = 0.18 + Math.sin(time * 0.6) * 0.04;
  }

  for (const ray of rays) {
    ray.material.opacity =
      ray.userData.baseOpacity *
      (0.75 + Math.sin(time * 0.5 + ray.userData.phase) * 0.25);
  }
}

function updateCamera(dt, time) {
  pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
  pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);

  const idleX = Math.sin(time * 0.14) * 0.08;
  const idleY = Math.cos(time * 0.18) * 0.05;

  camera.position.x = 0.35 + pointer.x * 0.8 + idleX;
  camera.position.y = 1.0 - pointer.y * 0.5 + idleY;
  camera.position.z = CAMERA_Z.value;
  camera.lookAt(0, -0.25, 0);

  if (dustPoints) {
    dustPoints.rotation.y = time * 0.006;
  }
}

/* ---------------------------------------------------------
   Loop
   --------------------------------------------------------- */

function animate() {
  window.requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  updateFish(dt, time);
  updatePellets(dt, time);
  updateBubbles(dt, time);
  updatePlants(time);
  updateWater(time);
  updateCamera(dt, time);

  composer.render();
}

/* ---------------------------------------------------------
   UI
   --------------------------------------------------------- */

function bindUI() {
  feedBtn?.addEventListener("click", () => feed());

  window.addEventListener(
    "pointermove",
    (event) => {
      pointer.tx = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (event.clientY / window.innerHeight) * 2 - 1;
    },
    { passive: true }
  );

  /* click on water to drop food there */
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();

  canvas.addEventListener("pointerdown", (event) => {
    ndc.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);

    if (raycaster.ray.intersectPlane(plane, hit)) {
      feed(hit.x, hit.z);
    } else {
      feed();
    }
  });

  if (reduceMotion) {
    /* keep the scene alive but calmer */
    document.documentElement.style.setProperty("--calm", "1");
  }
}

/* ---------------------------------------------------------
   Boot
   --------------------------------------------------------- */

init();
