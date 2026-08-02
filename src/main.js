import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createCinemaLobby } from './lobby.js';
import { loadCinemaConfig, resolveCinemaText } from './cinemaConfig.js';
import './style.css';

const cinemaCopy = {
  cinemaName: 'VELVET 07',
  muralTitle: 'THE DREAMING MACHINE',
  muralSubtitle: 'LIGHT  ·  SHADOW  ·  MEMORY',
  screenBrand: '{cinemaName}  ·  PRIVATE AUDITORIUM',
  screenEnter: '单击进入影厅',
  screenWaiting: '等待片源',
  screenPaused: '放映暂停',
  screenDemoTitle: 'THE LAST LIGHT',
  screenControls: 'WASD 移动  ·  鼠标环顾  ·  E 交互  ·  R 遥控器',
  screenSourceHint: '请使用银幕下方的传输机，或按 R 抬起遥控器',
  terminalTitle: 'SOURCE TRANSFER',
  terminalConnected: '片源已连接',
  terminalConnectPrompt: 'E · 连接本地影片',
  terminalPlaying: 'PLAYING',
  terminalPaused: 'PAUSED',
  terminalPrivate: 'LOCAL LINK · PRIVATE',
  remoteBrand: '{cinemaName}',
  remoteHouseLight: 'HOUSE LIGHT',
  remoteOn: 'ON',
  remoteOff: 'OFF',
  remotePlayState: 'PLAY',
  remotePauseState: 'PAUSE',
  remoteNoSource: 'NO SOURCE',
  remoteRaisedHint: 'R · LOWER   H · HIDE',
  remoteLoweredHint: 'R · RAISE   H · HIDE',
  remoteButtonLights: 'LIGHT',
  remoteButtonPlay: 'PLAY',
  remoteButtonSource: 'SOURCE',
  remoteButtonStop: 'STOP',
};

const canvas = document.querySelector('#cinema');
const fileInput = document.querySelector('#fileInput');
const video = document.querySelector('#videoSource');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);
scene.fog = new THREE.FogExp2(0x050305, 0.0095);

const camera = new THREE.PerspectiveCamera(63, innerWidth / innerHeight, 0.07, 120);
camera.rotation.order = 'YXZ';
camera.position.set(-40, 1.7, 8);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,
});
renderer.setSize(innerWidth, innerHeight);
const maxPixelRatio = matchMedia('(pointer: coarse)').matches ? 1 : 1.25;
const nativeRenderPixelRatio = Math.min(devicePixelRatio, maxPixelRatio);
const minimumCinemaPixelRatio = Math.min(nativeRenderPixelRatio, 1);
let renderPixelRatio = nativeRenderPixelRatio;
let playbackPixelRatioCeiling = nativeRenderPixelRatio;
renderer.setPixelRatio(renderPixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.91;
renderer.shadowMap.enabled = false;

function setRenderPixelRatio(nextRatio) {
  // Never render below one physical pixel per CSS pixel on normal desktop displays.
  // The movie surface must stay crisp even when the rest of the scene is under load.
  const clamped = THREE.MathUtils.clamp(nextRatio, minimumCinemaPixelRatio, nativeRenderPixelRatio);
  if (Math.abs(clamped - renderPixelRatio) < 0.025) return;
  renderPixelRatio = clamped;
  renderer.setPixelRatio(renderPixelRatio);
  renderer.setSize(innerWidth, innerHeight, false);
}

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const centerPointer = new THREE.Vector2(0, 0);
const freePointer = new THREE.Vector2();
const tempVector = new THREE.Vector3();
const keys = new Set();

const ROWS = [
  { letter: 'A', z: -13.5, y: 0.55 },
  { letter: 'B', z: -9.3, y: 1.10 },
  { letter: 'C', z: -5.1, y: 1.65 },
  { letter: 'D', z: -0.9, y: 2.20 },
  { letter: 'E', z: 3.3, y: 2.75 },
  { letter: 'F', z: 7.5, y: 3.30 },
  { letter: 'G', z: 11.7, y: 3.85 },
  { letter: 'H', z: 15.9, y: 4.40 },
  { letter: 'I', z: 20.1, y: 4.95 },
];
const SEAT_XS = [-16, -14.45, -12.9, -11.35, -9.8, -8.25, -6.7, -5.15, -3.6, -2.05, 2.05, 3.6, 5.15, 6.7, 8.25, 9.8, 11.35, 12.9, 14.45, 16];
const HALL_WIDTH = 40;
const HALL_HALF = HALL_WIDTH / 2;
const HALL_DEPTH = 56;
const HALL_HEIGHT = 20;
const FRONT_WALL_Z = -28;
const REAR_WALL_Z = 28;
const REAR_LANDING_Y = 5.55;
const SCREEN_WIDTH = 35.5;
const SCREEN_HEIGHT = 18.7;
const SCREEN_Y = 10;
const SCREEN_Z = -27.2;
const SCREEN_ASPECT = SCREEN_WIDTH / SCREEN_HEIGHT;
const LEFT_ENTRANCE_Z = -20.35;
const LEFT_ENTRANCE_FRONT_Z = -22.45;
const LEFT_ENTRANCE_REAR_Z = -18.25;

const state = {
  entered: false,
  locked: false,
  yaw: 0,
  pitch: -0.075,
  targetYaw: 0,
  targetPitch: -0.075,
  moving: false,
  seated: false,
  seat: null,
  seatedYawCenter: null,
  action: null,
  gazeSeat: null,
  gazeTerminal: false,
  gazeLobbyInteraction: null,
  kioskActive: false,
  kioskHover: null,
  ticketRaised: false,
  ticketHidden: false,
  playing: false,
  hasVideo: false,
  lightsOn: true,
  lightLevel: 1,
  remoteRaised: false,
  remoteHidden: false,
  remoteHover: null,
  bobTime: 0,
  entranceHint: true,
};

function makeSurfaceTexture(base, accent, pattern, repeatX, repeatY) {
  const surface = document.createElement('canvas');
  surface.width = 256;
  surface.height = 256;
  const ctx = surface.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  if (pattern === 'fabric') {
    ctx.globalAlpha = 0.2;
    for (let x = 0; x < 256; x += 3) {
      ctx.fillStyle = x % 6 ? accent : '#000000';
      ctx.fillRect(x, 0, 1, 256);
    }
    for (let i = 0; i < 2100; i++) {
      ctx.globalAlpha = 0.035 + Math.random() * 0.06;
      ctx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
  } else if (pattern === 'carpet') {
    for (let i = 0; i < 3200; i++) {
      ctx.globalAlpha = 0.05 + Math.random() * 0.12;
      ctx.fillStyle = Math.random() > 0.64 ? accent : '#050304';
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      ctx.fillRect(x, y, Math.random() * 2 + 0.5, Math.random() * 5 + 1);
    }
  } else if (pattern === 'velvet') {
    const sheen = ctx.createLinearGradient(0, 0, 256, 256);
    sheen.addColorStop(0, 'rgba(255,255,255,.08)');
    sheen.addColorStop(0.48, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,.14)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1700; i++) {
      ctx.globalAlpha = 0.025 + Math.random() * 0.055;
      ctx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, Math.random() * 4 + 1);
    }
  } else if (pattern === 'wood') {
    for (let y = 0; y < 256; y += 16) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = y % 32 ? accent : '#050303';
      ctx.fillRect(0, y, 256, 1);
    }
    for (let i = 0; i < 26; i++) {
      ctx.globalAlpha = 0.08;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      const y = Math.random() * 256;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(70, y + Math.random() * 8, 180, y - Math.random() * 8, 256, y + Math.random() * 5);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

const wallFabricTexture = makeSurfaceTexture('#171012', '#39282d', 'fabric', 2, 8);
const darkFabricTexture = makeSurfaceTexture('#090708', '#251a1c', 'fabric', 2, 8);
const carpetTexture = makeSurfaceTexture('#2a0b10', '#7d2730', 'carpet', 7, 15);
const velvetTexture = makeSurfaceTexture('#c8bfc0', '#ffffff', 'velvet', 2, 3);
const curtainTexture = makeSurfaceTexture('#8f6970', '#ffffff', 'velvet', 2, 5);
const woodTexture = makeSurfaceTexture('#26130f', '#8b5938', 'wood', 5, 8);

const materials = {
  wall: new THREE.MeshStandardMaterial({ color: 0xffffff, map: wallFabricTexture, bumpMap: wallFabricTexture, bumpScale: 0.035, roughness: 0.96 }),
  wallDark: new THREE.MeshStandardMaterial({ color: 0xffffff, map: darkFabricTexture, bumpMap: darkFabricTexture, bumpScale: 0.026, roughness: 0.93 }),
  carpet: new THREE.MeshStandardMaterial({ color: 0xffffff, map: carpetTexture, bumpMap: carpetTexture, bumpScale: 0.045, roughness: 1 }),
  carpetEdge: new THREE.MeshStandardMaterial({ color: 0x61161d, emissive: 0x260508, emissiveIntensity: 0.15, roughness: 0.9 }),
  brass: new THREE.MeshStandardMaterial({ color: 0x8a5a2e, roughness: 0.32, metalness: 0.76 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.34, metalness: 0.72 }),
  curtain: new THREE.MeshStandardMaterial({ color: 0x510c16, map: curtainTexture, bumpMap: curtainTexture, bumpScale: 0.04, roughness: 0.94 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTexture, bumpMap: woodTexture, bumpScale: 0.035, roughness: 0.68, metalness: 0.06 }),
};

function addBox(name, size, position, material, parent = scene) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

// A flagship auditorium shell, proportioned around a near record-scale 1.90:1 screen.
addBox('floor', [HALL_WIDTH - 0.2, 0.25, HALL_DEPTH], [0, -0.18, 0], materials.wallDark);
addBox('ceiling', [HALL_WIDTH, 0.34, HALL_DEPTH], [0, HALL_HEIGHT - 0.1, 0], materials.wallDark);
// The auditorium is entered through a front side sound lock, as in a real premium hall.
addBox('left-wall-front', [0.42, HALL_HEIGHT, 5.55], [-HALL_HALF, HALL_HEIGHT / 2 - 0.15, -25.225], materials.wall);
addBox('left-wall-rear', [0.42, HALL_HEIGHT, 46.25], [-HALL_HALF, HALL_HEIGHT / 2 - 0.15, 4.875], materials.wall);
addBox('left-door-lintel', [0.42, 14.72, 4.2], [-HALL_HALF, 12.64, LEFT_ENTRANCE_Z], materials.wall);
addBox('right-wall', [0.42, HALL_HEIGHT, HALL_DEPTH], [HALL_HALF, HALL_HEIGHT / 2 - 0.15, 0], materials.wall);
addBox('rear-wall', [HALL_WIDTH, HALL_HEIGHT, 0.36], [0, HALL_HEIGHT / 2 - 0.15, REAR_WALL_Z], materials.wallDark);
addBox('screen-wall', [HALL_WIDTH, HALL_HEIGHT, 0.4], [0, HALL_HEIGHT / 2 - 0.15, FRONT_WALL_Z], materials.wallDark);
addBox('stage-floor', [HALL_WIDTH - 2, 0.25, 5.4], [0, 0.03, -25.15], materials.wood);

for (const side of [-1, 1]) {
  if (side < 0) {
    addBox('lower-wall-wood-front', [0.28, 4.1, 4.95], [side * (HALL_HALF - 0.48), 2.02, -25.025], materials.wood);
    addBox('lower-wall-wood-rear', [0.28, 4.1, 45.75], [side * (HALL_HALF - 0.48), 2.02, 4.625], materials.wood);
  } else {
    addBox('lower-wall-wood', [0.28, 4.1, HALL_DEPTH - 1], [side * (HALL_HALF - 0.48), 2.02, 0], materials.wood);
  }
  addBox('upper-cove-trim', [0.14, 0.12, HALL_DEPTH - 1.3], [side * (HALL_HALF - 0.46), 16.75, 0], materials.brass);
  for (let z = -24.2; z <= 24.2; z += 4.85) {
    if (side < 0 && z > LEFT_ENTRANCE_FRONT_Z - 1 && z < LEFT_ENTRANCE_REAR_Z + 1) continue;
    addBox('acoustic-panel', [0.25, 10.7, 3.9], [side * (HALL_HALF - 0.24), 10.2, z], materials.wallDark);
    const trim = addBox('brass-trim', [0.14, 10.9, 0.055], [side * (HALL_HALF - 0.39), 10.2, z + 2.02], materials.brass);
    trim.rotation.y = Math.PI / 2;
  }
}

for (let z = -23; z < 27; z += 6.1) {
  addBox('ceiling-coffer', [28.5, 0.24, 3.4], [0, HALL_HEIGHT - 0.43, z], materials.wall);
  for (let x = -12.6; x <= 12.6; x += 2.1) {
    const star = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffd7a8 }));
    star.position.set(x, HALL_HEIGHT - 0.59, z);
    scene.add(star);
  }
}

// Raked floor with physical stair edges.
const aisleLights = [];
for (const row of ROWS) {
  addBox(`tier-${row.letter}`, [HALL_WIDTH - 0.7, row.y + 0.18, 4.28], [0, (row.y - 0.18) / 2, row.z + 0.52], materials.carpet);
  addBox('step-edge', [HALL_WIDTH - 0.95, 0.055, 0.1], [0, row.y + 0.025, row.z - 1.58], materials.carpetEdge);
  for (const side of [-1, 1]) {
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xd27b36 });
    const led = addBox('aisle-light', [0.14, 0.055, 0.34], [side * 1.2, row.y + 0.06, row.z - 1.54], ledMat);
    aisleLights.push(led);
  }
}
// Continuous rear landing closes the geometry behind the final row.
addBox('rear-landing', [HALL_WIDTH - 0.7, REAR_LANDING_Y + 0.18, 5.7], [0, (REAR_LANDING_Y - 0.18) / 2, 25.05], materials.carpet);
addBox('rear-landing-edge', [HALL_WIDTH - 0.95, 0.06, 0.12], [0, REAR_LANDING_Y + 0.025, 22.24], materials.carpetEdge);

// Wall and row lights are safety lighting; they remain gently visible when the main lights are off.
const houseLights = [];
const houseLightMaterials = [];
const activeSconceZs = new Set([-11.2, 15.2]);
for (const side of [-1, 1]) {
  for (const z of [-20, -11.2, -2.4, 6.4, 15.2, 23]) {
    if (side < 0 && z === -20) continue;
    const sconce = new THREE.Group();
    sconce.position.set(side * (HALL_HALF - 0.57), 8.4, z);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.28, 0.18), materials.brass);
    stem.rotation.z = Math.PI / 2;
    const glowMaterial = new THREE.MeshStandardMaterial({ color: 0x6b351c, emissive: 0xe07830, emissiveIntensity: 0.52, roughness: 0.5 });
    houseLightMaterials.push(glowMaterial);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.31, 10, 8), glowMaterial);
    globe.position.set(-side * 0.27, 0.74, 0);
    sconce.add(stem, globe);
    scene.add(sconce);
    // Every sconce remains visible, but only alternating fixtures emit real light.
    // This cuts the forward-rendered point-light shader cost in half.
    if (activeSconceZs.has(z)) {
      const light = new THREE.PointLight(0xf0a15e, 0.9, 15.5, 2.15);
      light.position.set(side * (HALL_HALF - 1.3), 8.6, z);
      scene.add(light);
      houseLights.push(light);
    }
  }
}

const rowLights = [];
// Seat and aisle visibility comes from the broad house wash plus emissive step markers.
// Avoiding per-row point lights removes six more full-scene fragment-light passes.

// The actual auditorium main lights: visible ceiling luminaires plus broad, room-filling light.
const ceilingFixtureMaterial = new THREE.MeshBasicMaterial({ color: 0xffddb7 });
const fixtureZs = [-22, -16, -10, -4, 2, 8, 14, 20, 25];
const ceilingFixtures = new THREE.InstancedMesh(new RoundedBoxGeometry(3.6, 0.1, 0.82, 3, 0.04), ceilingFixtureMaterial, fixtureZs.length * 2);
const fixtureTransform = new THREE.Object3D();
let fixtureIndex = 0;
for (const z of fixtureZs) {
  for (const x of [-8.6, 8.6]) {
    fixtureTransform.position.set(x, HALL_HEIGHT - 0.62, z);
    fixtureTransform.updateMatrix();
    ceilingFixtures.setMatrixAt(fixtureIndex++, fixtureTransform.matrix);
  }
}
ceilingFixtures.instanceMatrix.needsUpdate = true;
scene.add(ceilingFixtures);

const hemisphereLight = new THREE.HemisphereLight(0xffd2b4, 0x24080b, 2.6);
const auditoriumAmbient = new THREE.AmbientLight(0xb77868, 1.4);
const mainLightFront = new THREE.DirectionalLight(0xffd7b7, 3.5);
mainLightFront.position.set(-10, 19, -14);
mainLightFront.target.position.set(0, 1, 5);
const mainLightRear = new THREE.DirectionalLight(0xffcba4, 2.4);
mainLightRear.position.set(11, 19, 18);
mainLightRear.target.position.set(0, 1, -7);
scene.add(hemisphereLight, auditoriumAmbient, mainLightFront, mainLightFront.target, mainLightRear, mainLightRear.target);
const screenBounce = new THREE.SpotLight(0xaec8ee, 3.4, 68, Math.PI * 0.32, 0.82, 1.25);
screenBounce.position.set(0, SCREEN_Y + 0.5, SCREEN_Z + 0.3);
screenBounce.target.position.set(0, 3.6, 5);
scene.add(screenBounce, screenBounce.target);

// Near record-scale IMAX geometry: a tall 1.90:1 surface dominates the proscenium.
addBox('screen-frame-top', [SCREEN_WIDTH + 0.58, 0.3, 0.4], [0, SCREEN_Y + SCREEN_HEIGHT / 2 + 0.17, SCREEN_Z - 0.19], materials.metal);
addBox('screen-frame-bottom', [SCREEN_WIDTH + 0.58, 0.3, 0.4], [0, SCREEN_Y - SCREEN_HEIGHT / 2 - 0.17, SCREEN_Z - 0.19], materials.metal);
addBox('screen-frame-left', [0.3, SCREEN_HEIGHT + 0.65, 0.4], [-SCREEN_WIDTH / 2 - 0.17, SCREEN_Y, SCREEN_Z - 0.19], materials.metal);
addBox('screen-frame-right', [0.3, SCREEN_HEIGHT + 0.65, 0.4], [SCREEN_WIDTH / 2 + 0.17, SCREEN_Y, SCREEN_Z - 0.19], materials.metal);
for (const side of [-1, 1]) {
  for (let i = 0; i < 8; i++) {
    const fold = addBox('curtain-fold', [0.46, 18.2, 0.46], [side * (18.25 + i * 0.16), 10, SCREEN_Z - 0.39 - (i % 2) * 0.055], materials.curtain);
    fold.rotation.z = side * (0.02 + i * 0.003);
  }
}

function makeCanvasTexture(width, height) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { element, context: element.getContext('2d'), texture };
}

// Rear-wall cinema mural: a custom in-world artwork, framed like a grand premiere-house fresco.
const muralCanvas = makeCanvasTexture(2048, 640);
function drawProceduralMural() {
  const { context: ctx, element, texture } = muralCanvas;
  const sky = ctx.createLinearGradient(0, 0, element.width, element.height);
  sky.addColorStop(0, '#090c15');
  sky.addColorStop(0.46, '#221524');
  sky.addColorStop(1, '#080b12');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, element.width, element.height);

  const horizon = ctx.createRadialGradient(1024, 420, 30, 1024, 420, 760);
  horizon.addColorStop(0, 'rgba(224,146,86,.75)');
  horizon.addColorStop(0.24, 'rgba(116,62,76,.34)');
  horizon.addColorStop(1, 'rgba(5,7,12,0)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, 0, element.width, element.height);

  let seed = 417;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 430; i++) {
    const radius = random() > 0.91 ? 2.2 : 0.7 + random() * 1.25;
    ctx.globalAlpha = 0.22 + random() * 0.62;
    ctx.fillStyle = random() > 0.82 ? '#e8bd83' : '#cfd9e8';
    ctx.beginPath();
    ctx.arc(random() * element.width, 35 + random() * 390, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.lineWidth = 7;
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = `rgba(211,151,91,${0.38 - i * 0.045})`;
    ctx.beginPath();
    ctx.ellipse(1024, 408, 240 + i * 120, 95 + i * 36, -0.08, Math.PI * 1.06, Math.PI * 1.94);
    ctx.stroke();
  }

  ctx.fillStyle = '#08090e';
  ctx.beginPath();
  ctx.moveTo(0, 515);
  for (let x = 0; x <= element.width; x += 70) {
    ctx.lineTo(x, 490 - Math.sin(x * 0.012) * 28 - random() * 45);
  }
  ctx.lineTo(element.width, element.height);
  ctx.lineTo(0, element.height);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ead9c0';
  ctx.font = '500 54px Georgia, serif';
  ctx.fillText(cinemaCopy.muralTitle, 1024, 535);
  ctx.fillStyle = '#a98763';
  ctx.font = '500 21px Arial, sans-serif';
  ctx.fillText(cinemaCopy.muralSubtitle, 1024, 580);
  texture.needsUpdate = true;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
}
drawProceduralMural();

const muralMaterial = new THREE.MeshBasicMaterial({ map: muralCanvas.texture, toneMapped: false });
const mural = new THREE.Mesh(
  new THREE.PlaneGeometry(25, 7.8),
  muralMaterial,
);
mural.position.set(0, 14.25, REAR_WALL_Z - 0.2);
mural.rotation.y = Math.PI;
scene.add(mural);
addBox('mural-frame-top', [25.6, 0.2, 0.25], [0, 18.27, REAR_WALL_Z - 0.31], materials.brass);
addBox('mural-frame-bottom', [25.6, 0.2, 0.25], [0, 10.23, REAR_WALL_Z - 0.31], materials.brass);
addBox('mural-frame-left', [0.2, 8.22, 0.25], [-12.7, 14.25, REAR_WALL_Z - 0.31], materials.brass);
addBox('mural-frame-right', [0.2, 8.22, 0.25], [12.7, 14.25, REAR_WALL_Z - 0.31], materials.brass);

// Projection booth glazing beneath the mural gives the rear wall a believable working-cinema purpose.
const boothGlass = new THREE.MeshStandardMaterial({ color: 0x10161b, emissive: 0x27323b, emissiveIntensity: 0.34, roughness: 0.18, metalness: 0.35 });
for (const x of [-7.2, 7.2]) {
  addBox('projection-window-frame', [5.3, 2.05, 0.26], [x, 7.75, REAR_WALL_Z - 0.28], materials.brass);
  addBox('projection-window-glass', [4.86, 1.62, 0.18], [x, 7.75, REAR_WALL_Z - 0.44], boothGlass);
  addBox('projection-window-divider', [0.07, 1.46, 0.1], [x, 7.75, REAR_WALL_Z - 0.56], materials.metal);
}

// Visible side and overhead arrays communicate the scale of a premium object-audio installation.
const speakerMaterial = new THREE.MeshStandardMaterial({ color: 0x090b0d, roughness: 0.84, metalness: 0.16 });
for (const side of [-1, 1]) {
  for (const z of [-20, -11.2, -2.4, 6.4, 15.2, 23]) {
    if (side < 0 && z === -20) continue;
    addBox('side-speaker', [0.44, 2.2, 1.35], [side * (HALL_HALF - 0.58), 12.7, z], speakerMaterial);
    addBox('side-speaker-trim', [0.48, 2.42, 0.06], [side * (HALL_HALF - 0.64), 12.7, z + 0.7], materials.metal);
  }
  for (const y of [4.1, 8, 11.9, 15.8]) {
    addBox('screen-speaker-stack', [0.48, 2.75, 1.52], [side * 18.55, y, SCREEN_Z + 0.18], speakerMaterial);
  }
}
for (const z of [-18, -8, 2, 12, 22]) {
  for (const x of [-12, -5.8, 5.8, 12]) {
    const overhead = addBox('overhead-speaker', [1.25, 0.34, 1.8], [x, HALL_HEIGHT - 0.72, z], speakerMaterial);
    overhead.rotation.x = x < 0 ? -0.08 : 0.08;
  }
}

// The public foyer is a separate render partition so it can disappear completely
// from scene traversal while a film is playing inside the auditorium.
const lobby = createCinemaLobby({
  materials,
  floorY: 0,
  renderer,
});
scene.add(lobby.root);
let lobbyAttached = true;
// The printed ticket is a first-person handheld object, mirroring the cinema
// remote's physical presence instead of remaining attached to the kiosk.
const ticketHand = new THREE.Group();
ticketHand.name = 'handheld-cinema-ticket';
ticketHand.position.set(0.1, -0.25, -0.72);
ticketHand.rotation.set(-0.16, -0.16, -0.04);
ticketHand.scale.setScalar(0.48);
ticketHand.visible = false;
camera.add(ticketHand);
const foregroundTicketMaterial = lobby.ticketMaterial.clone();
foregroundTicketMaterial.transparent = true;
foregroundTicketMaterial.opacity = 1;
foregroundTicketMaterial.depthTest = false;
foregroundTicketMaterial.depthWrite = false;
foregroundTicketMaterial.toneMapped = false;
const ticketCardMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.44), foregroundTicketMaterial);
ticketCardMesh.name = 'foreground-ticket-card';
ticketCardMesh.renderOrder = 10000;
ticketCardMesh.frustumCulled = false;
// Clear the world's depth buffer immediately before the ticket pass. Together
// with the transparent late render pass this prevents glass, mullions or
// exterior buildings from ever drawing through the ticket surface.
ticketCardMesh.onBeforeRender = (activeRenderer) => activeRenderer.clearDepth();
ticketHand.add(ticketCardMesh);
let previousInsideAuditorium = false;

function getLobbyAcousticExposure() {
  const doorwayZ = -20.35;
  if (camera.position.x <= -19.2) {
    // The poster corridor is a sound lock: the foyer gradually loses sparkle
    // before the listener even reaches the auditorium door.
    const corridorT = THREE.MathUtils.smoothstep(-camera.position.z, 8, 21);
    return THREE.MathUtils.lerp(1, 0.58, corridorT);
  }
  const portalDistance = Math.hypot(camera.position.x + 19.2, camera.position.z - doorwayZ);
  const roomT = THREE.MathUtils.smoothstep(portalDistance, 0.7, 8.7);
  return 0.58 * (1 - roomT);
}

function syncLobbyRendering() {
  const insideAuditorium = isInsideAuditorium();
  if (insideAuditorium !== previousInsideAuditorium) {
    previousInsideAuditorium = insideAuditorium;
    lobby.clearTicket();
    state.kioskActive = false;
    state.kioskHover = null;
    lobby.setKioskHover(null);
    state.ticketRaised = false;
    state.ticketHidden = false;
    ticketHand.visible = false;
  }
  const shouldAttach = !(state.playing && insideAuditorium);
  if (shouldAttach && !lobbyAttached) {
    scene.add(lobby.root);
    lobby.root.updateMatrixWorld(true);
    lobbyAttached = true;
  } else if (!shouldAttach && lobbyAttached) {
    scene.remove(lobby.root);
    lobbyAttached = false;
  }
  const acousticExposure = getLobbyAcousticExposure();
  const lobbyMediaAudible = shouldAttach && acousticExposure > 0.025;
  lobby.setAcousticExposure(acousticExposure);
  lobby.setMediaActive(lobbyMediaAudible);
  lobby.setMusicActive(lobbyMediaAudible);
}

function isInsideAuditorium() {
  return camera.position.x > -19.2;
}

const filmCanvas = makeCanvasTexture(1280, 540);
const screenMaterial = new THREE.MeshBasicMaterial({ map: filmCanvas.texture, toneMapped: false });
const screenBacking = new THREE.Mesh(
  new THREE.PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT),
  new THREE.MeshBasicMaterial({ color: 0x010102, toneMapped: false }),
);
screenBacking.position.set(0, SCREEN_Y, SCREEN_Z - 0.045);
scene.add(screenBacking);
const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT), screenMaterial);
screen.position.set(0, SCREEN_Y, SCREEN_Z);
scene.add(screen);

let currentScreenMode = 'entry';
let currentScreenTime = 0;
function drawScreen(mode = 'entry', time = 0) {
  currentScreenMode = mode;
  currentScreenTime = time;
  const { context: ctx, element, texture } = filmCanvas;
  const w = element.width;
  const h = element.height;
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, mode === 'film' ? '#263c4b' : '#0e0e11');
  gradient.addColorStop(0.5, mode === 'film' ? '#9b5a3e' : '#171215');
  gradient.addColorStop(1, '#080709');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#bb9a78';
  ctx.font = '500 15px Arial, sans-serif';
  ctx.fillText(cinemaCopy.screenBrand, w / 2, 185);
  ctx.fillStyle = '#eee6dc';
  ctx.font = '500 48px Georgia, "Microsoft YaHei", serif';
  if (mode === 'entry') ctx.fillText(cinemaCopy.screenEnter, w / 2, 260);
  else if (mode === 'waiting') ctx.fillText(cinemaCopy.screenWaiting, w / 2, 260);
  else if (mode === 'paused') ctx.fillText(cinemaCopy.screenPaused, w / 2, 260);
  else if (mode === 'film') {
    const sunX = w * (0.68 + Math.sin(time * 0.00012) * 0.04);
    const halo = ctx.createRadialGradient(sunX, 220, 3, sunX, 220, 190);
    halo.addColorStop(0, 'rgba(255,226,165,.95)');
    halo.addColorStop(0.35, 'rgba(225,126,68,.48)');
    halo.addColorStop(1, 'rgba(65,18,17,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#08090b';
    ctx.beginPath();
    ctx.moveTo(0, 390);
    for (let x = 0; x <= w; x += 85) ctx.lineTo(x, 350 + Math.sin(x * 0.012 + time * 0.0002) * 42);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,244,224,.86)';
    ctx.font = '500 16px Arial, sans-serif';
    ctx.fillText(cinemaCopy.screenDemoTitle, w / 2, 495);
  }
  if (mode !== 'film') {
    ctx.fillStyle = '#8d7564';
    ctx.font = '400 16px Arial, "Microsoft YaHei", sans-serif';
    const line = mode === 'entry' ? cinemaCopy.screenControls : cinemaCopy.screenSourceHint;
    ctx.fillText(line, w / 2, 312);
  }
  texture.needsUpdate = true;
}
drawScreen('entry');

// 180 premium seats remain GPU-friendly through shared instanced upholstery parts.
const seats = [];
for (const row of ROWS) {
  SEAT_XS.forEach((x, index) => {
    seats.push({
      index: seats.length,
      row: row.letter,
      number: index + 1,
      label: `${row.letter}排 ${index + 1}座`,
      x,
      y: row.y,
      z: row.z,
      angle: x * -0.007,
    });
  });
}

const seatPalette = {
  upholstery: new THREE.Color(0x3c4043),
  dark: new THREE.Color(0x17191b),
  piping: new THREE.Color(0x62686c),
  brass: new THREE.Color(0x8c7552),
  metal: new THREE.Color(0x0d0f11),
  hover: new THREE.Color(0xd49155),
  selected: new THREE.Color(0x737b80),
};

const seatParts = [];
function createSeatInstances(name, geometry, baseColor, localPosition, localRotation = [0, 0, 0], surface = 'velvet', colorable = true) {
  const material = surface === 'metal' || surface === 'brass'
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: surface === 'brass' ? 0.25 : 0.3, metalness: 0.76, vertexColors: true })
    : new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: velvetTexture,
        bumpMap: velvetTexture,
        bumpScale: surface === 'piping' ? 0.012 : 0.035,
        roughness: surface === 'piping' ? 0.72 : 0.91,
        metalness: surface === 'brass' ? 0.62 : 0.01,
        vertexColors: true,
      });
  const mesh = new THREE.InstancedMesh(geometry, material, seats.length);
  mesh.name = name;
  mesh.userData.seatInstances = true;
  const rootMatrix = new THREE.Matrix4();
  const localMatrix = new THREE.Matrix4();
  const resultMatrix = new THREE.Matrix4();
  const rootQuaternion = new THREE.Quaternion();
  const localQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...localRotation));
  const unitScale = new THREE.Vector3(1, 1, 1);
  for (const seat of seats) {
    rootQuaternion.setFromEuler(new THREE.Euler(0, seat.angle, 0));
    rootMatrix.compose(new THREE.Vector3(seat.x, seat.y + 0.12, seat.z), rootQuaternion, unitScale);
    localMatrix.compose(new THREE.Vector3(...localPosition), localQuaternion, unitScale);
    resultMatrix.multiplyMatrices(rootMatrix, localMatrix);
    mesh.setMatrixAt(seat.index, resultMatrix);
    mesh.setColorAt(seat.index, baseColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  seatParts.push({ mesh, baseColor, colorable });
  return mesh;
}

createSeatInstances('seat-back-shells', new RoundedBoxGeometry(1.18, 1.42, 0.18, 3, 0.075), seatPalette.dark, [0, 0.92, 0.34], [-0.045, 0, 0]);
createSeatInstances('seat-headrests', new RoundedBoxGeometry(1.08, 0.37, 0.29, 3, 0.1), seatPalette.upholstery, [0, 1.36, 0.17], [-0.035, 0, 0]);
createSeatInstances('seat-mid-backs', new RoundedBoxGeometry(1.03, 0.5, 0.26, 3, 0.08), seatPalette.upholstery, [0, 0.93, 0.13], [-0.04, 0, 0]);
createSeatInstances('seat-lower-backs', new RoundedBoxGeometry(1.01, 0.32, 0.24, 3, 0.075), seatPalette.upholstery, [0, 0.56, 0.09], [-0.035, 0, 0]);
createSeatInstances('seat-side-trim-left', new RoundedBoxGeometry(0.09, 1.22, 0.22, 2, 0.038), seatPalette.dark, [-0.585, 0.92, 0.22], [-0.045, 0, 0]);
createSeatInstances('seat-side-trim-right', new RoundedBoxGeometry(0.09, 1.22, 0.22, 2, 0.038), seatPalette.dark, [0.585, 0.92, 0.22], [-0.045, 0, 0]);
createSeatInstances('seat-back-seam-upper', new RoundedBoxGeometry(0.88, 0.022, 0.018, 1, 0.006), seatPalette.piping, [0, 1.16, -0.005], [-0.04, 0, 0], 'piping');
createSeatInstances('seat-back-seam-lower', new RoundedBoxGeometry(0.85, 0.02, 0.018, 1, 0.006), seatPalette.piping, [0, 0.73, -0.01], [-0.04, 0, 0], 'piping');
createSeatInstances('seat-cushions', new RoundedBoxGeometry(1.14, 0.25, 1.08, 3, 0.1), seatPalette.upholstery, [0, 0.35, -0.17], [-0.025, 0, 0]);
createSeatInstances('seat-cushion-front-seams', new RoundedBoxGeometry(0.98, 0.022, 0.026, 1, 0.006), seatPalette.piping, [0, 0.4, -0.71], [0, 0, 0], 'piping');
createSeatInstances('seat-front-aprons', new RoundedBoxGeometry(1.05, 0.25, 0.13, 2, 0.048), seatPalette.dark, [0, 0.2, -0.67]);
createSeatInstances('seat-arms-left', new RoundedBoxGeometry(0.16, 0.19, 1.04, 2, 0.055), seatPalette.dark, [-0.68, 0.61, -0.16]);
createSeatInstances('seat-arms-right', new RoundedBoxGeometry(0.16, 0.19, 1.04, 2, 0.055), seatPalette.dark, [0.68, 0.61, -0.16]);
createSeatInstances('seat-cupholders', new THREE.TorusGeometry(0.055, 0.014, 6, 12), seatPalette.brass, [0.68, 0.715, -0.43], [Math.PI / 2, 0, 0], 'brass', false);
createSeatInstances('seat-legs-left', new THREE.BoxGeometry(0.08, 0.42, 0.1), seatPalette.metal, [-0.46, 0.12, 0.2], [0, 0, 0], 'metal', false);
createSeatInstances('seat-legs-right', new THREE.BoxGeometry(0.08, 0.42, 0.1), seatPalette.metal, [0.46, 0.12, 0.2], [0, 0, 0], 'metal', false);

function refreshSeatColors() {
  for (const part of seatParts) {
    if (!part.colorable) continue;
    for (const seat of seats) {
      let color = part.baseColor;
      if (state.seat?.index === seat.index) color = seatPalette.selected;
      if (state.gazeSeat?.index === seat.index) color = seatPalette.hover;
      part.mesh.setColorAt(seat.index, color);
    }
    part.mesh.instanceColor.needsUpdate = true;
  }
}

// Physical source terminal below the screen.
const terminal = new THREE.Group();
terminal.position.set(0, 0.08, -24.15);
const terminalBody = new THREE.Mesh(new RoundedBoxGeometry(2.45, 0.78, 1.08, 4, 0.08), materials.metal);
terminalBody.position.y = 0.5;
terminalBody.userData.terminal = true;
const terminalPanel = makeCanvasTexture(768, 256);
const terminalScreenMaterial = new THREE.MeshBasicMaterial({ map: terminalPanel.texture, toneMapped: false });
const terminalScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.72, 0.55), terminalScreenMaterial);
terminalScreen.position.set(0, 0.86, 0.02);
terminalScreen.rotation.x = -Math.PI / 2 + 0.18;
terminalScreen.userData.terminal = true;
terminal.add(terminalBody, terminalScreen);
scene.add(terminal);
const terminalGlow = new THREE.PointLight(0x58d7b4, 0.75, 3.8, 2);
terminalGlow.position.set(0, 1.05, -23.95);
scene.add(terminalGlow);

function drawTerminal(active = false) {
  const { context: ctx, element, texture } = terminalPanel;
  ctx.fillStyle = '#071412';
  ctx.fillRect(0, 0, element.width, element.height);
  ctx.strokeStyle = active ? '#8ff7d7' : '#376d5f';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, element.width - 20, element.height - 20);
  ctx.textAlign = 'left';
  ctx.fillStyle = active ? '#9dffe2' : '#5cb69e';
  ctx.font = '600 28px Arial, sans-serif';
  ctx.fillText(cinemaCopy.terminalTitle, 48, 72);
  ctx.fillStyle = '#d9eee8';
  ctx.font = '500 36px "Microsoft YaHei", sans-serif';
  const fileLabel = state.hasVideo ? video.dataset.fileName || cinemaCopy.terminalConnected : cinemaCopy.terminalConnectPrompt;
  ctx.fillText(fileLabel.length > 26 ? `${fileLabel.slice(0, 24)}…` : fileLabel, 48, 138);
  ctx.fillStyle = '#559b88';
  ctx.font = '400 20px Arial, sans-serif';
  ctx.fillText(
    state.hasVideo ? (state.playing ? cinemaCopy.terminalPlaying : cinemaCopy.terminalPaused) : cinemaCopy.terminalPrivate,
    48,
    194,
  );
  texture.needsUpdate = true;
}
drawTerminal();

// A real 3D remote lives in the viewer's hand and rises into view with R.
const remote = new THREE.Group();
remote.position.set(0.46, -0.35, -0.72);
remote.rotation.set(-0.16, -0.24, -0.05);
remote.scale.setScalar(0.58);
remote.visible = false;
camera.add(remote);

const remoteBodyMaterial = new THREE.MeshBasicMaterial({ color: 0x29272b });
const remoteBody = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.68, 0.07, 4, 0.025), remoteBodyMaterial);
remote.add(remoteBody);
const remoteDisplay = makeCanvasTexture(384, 220);
const remoteDisplayMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.18), new THREE.MeshBasicMaterial({ map: remoteDisplay.texture, toneMapped: false }));
remoteDisplayMesh.position.set(0, 0.18, 0.041);
remote.add(remoteDisplayMesh);

const remoteButtons = [];
const buttonSpecs = [
  { action: 'lights', x: -0.09, y: -0.015, color: 0xc88942, label: cinemaCopy.remoteButtonLights },
  { action: 'play', x: 0.09, y: -0.015, color: 0x68b99f, label: cinemaCopy.remoteButtonPlay },
  { action: 'source', x: -0.09, y: -0.17, color: 0x587c9f, label: cinemaCopy.remoteButtonSource },
  { action: 'stop', x: 0.09, y: -0.17, color: 0x8c3b3e, label: cinemaCopy.remoteButtonStop },
];

function buttonLabelTexture(label) {
  const panel = makeCanvasTexture(256, 96);
  panel.context.fillStyle = '#0a0a0b';
  panel.context.fillRect(0, 0, 256, 96);
  panel.context.textAlign = 'center';
  panel.context.fillStyle = '#d9d5cf';
  panel.context.font = '600 28px Arial, sans-serif';
  panel.context.fillText(label, 128, 59);
  panel.texture.needsUpdate = true;
  return panel.texture;
}

for (const spec of buttonSpecs) {
  const group = new THREE.Group();
  group.position.set(spec.x, spec.y, 0.055);
  const material = new THREE.MeshBasicMaterial({ color: spec.color });
  const button = new THREE.Mesh(new RoundedBoxGeometry(0.135, 0.1, 0.028, 3, 0.018), material);
  button.userData.remoteAction = spec.action;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.039), new THREE.MeshBasicMaterial({ map: buttonLabelTexture(spec.label), transparent: true }));
  label.position.z = 0.016;
  label.userData.remoteAction = spec.action;
  group.add(button, label);
  remote.add(group);
  remoteButtons.push({ button, label, material, action: spec.action, color: new THREE.Color(spec.color) });
}

// The handheld controller is always rendered in front of world geometry when raised,
// so nearby armrests or seat backs can never cut through it.
remote.traverse((child) => {
  if (!child.isMesh) return;
  child.renderOrder = 1000;
  const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
  for (const material of childMaterials) {
    material.depthTest = false;
    material.depthWrite = false;
  }
});

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

let lastRemoteDraw = 0;
function drawRemote(now = 0, force = false) {
  if (!force && state.remoteHidden) return;
  const refreshInterval = state.hasVideo && state.playing ? 500 : 220;
  if (!force && now - lastRemoteDraw < refreshInterval) return;
  lastRemoteDraw = now;
  const { context: ctx, element, texture } = remoteDisplay;
  ctx.fillStyle = '#07100f';
  ctx.fillRect(0, 0, element.width, element.height);
  ctx.fillStyle = '#579f8b';
  ctx.font = '600 20px Arial, sans-serif';
  ctx.fillText(cinemaCopy.remoteBrand, 24, 38);
  ctx.fillStyle = state.lightsOn ? '#efb56e' : '#60716b';
  ctx.font = '600 27px Arial, sans-serif';
  ctx.fillText(`${cinemaCopy.remoteHouseLight}  ${state.lightsOn ? cinemaCopy.remoteOn : cinemaCopy.remoteOff}`, 24, 86);
  ctx.fillStyle = '#e1ebe7';
  ctx.font = '500 25px Arial, sans-serif';
  const transport = state.hasVideo
    ? `${state.playing ? cinemaCopy.remotePlayState : cinemaCopy.remotePauseState}  ${formatTime(video.currentTime)}`
    : cinemaCopy.remoteNoSource;
  ctx.fillText(transport, 24, 128);
  ctx.fillStyle = '#55746b';
  ctx.font = '500 18px Arial, sans-serif';
  ctx.fillText(state.remoteRaised ? cinemaCopy.remoteRaisedHint : cinemaCopy.remoteLoweredHint, 24, 180);
  texture.needsUpdate = true;
}
drawRemote(0, true);

function applyCinemaConfiguration(config) {
  cinemaCopy.cinemaName = String(config.cinemaName || cinemaCopy.cinemaName);
  const uiText = config.uiText ?? {};
  for (const key of Object.keys(cinemaCopy)) {
    if (key === 'cinemaName') continue;
    cinemaCopy[key] = resolveCinemaText(uiText[key], cinemaCopy[key], cinemaCopy.cinemaName);
  }

  const rearImageUrl = config.images?.auditoriumRear || config.auditoriumRearImage;
  if (rearImageUrl) {
    const image = new Image();
    image.onload = () => {
      const { context: ctx, element, texture } = muralCanvas;
      ctx.fillStyle = '#07090e';
      ctx.fillRect(0, 0, element.width, element.height);
      const scale = Math.min(element.width / image.naturalWidth, element.height / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      ctx.drawImage(image, (element.width - width) * 0.5, (element.height - height) * 0.5, width, height);
      texture.needsUpdate = true;
    };
    image.onerror = drawProceduralMural;
    image.src = rearImageUrl;
  } else drawProceduralMural();

  const remoteButtonCopy = {
    lights: cinemaCopy.remoteButtonLights,
    play: cinemaCopy.remoteButtonPlay,
    source: cinemaCopy.remoteButtonSource,
    stop: cinemaCopy.remoteButtonStop,
  };
  for (const entry of remoteButtons) {
    entry.label.material.map?.dispose();
    entry.label.material.map = buttonLabelTexture(remoteButtonCopy[entry.action]);
    entry.label.material.needsUpdate = true;
  }
  drawScreen(currentScreenMode, currentScreenTime);
  drawTerminal(state.gazeTerminal);
  drawRemote(0, true);
}

loadCinemaConfig().then(applyCinemaConfiguration);

// Web Audio is used only for film playback—there are no ambient or interaction sounds.
let audioContext;
let movieAudioReady = false;
let movieMaster;

function ensureAudio() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    try {
      audioContext = new AudioContextClass({ latencyHint: 'playback' });
    } catch {
      audioContext = new AudioContextClass();
    }
  }
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

function makeCinemaPanner(ctx, x, y, z, referenceDistance = 18, panningModel = 'HRTF') {
  const panner = ctx.createPanner();
  panner.panningModel = panningModel;
  panner.distanceModel = 'inverse';
  panner.refDistance = referenceDistance;
  panner.maxDistance = 120;
  panner.rolloffFactor = 0.22;
  panner.coneInnerAngle = 270;
  panner.coneOuterAngle = 360;
  panner.coneOuterGain = 0.72;
  if (panner.positionX) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else panner.setPosition(x, y, z);
  return panner;
}

function setupMovieAudio() {
  if (movieAudioReady) return;
  const ctx = ensureAudio();
  video.muted = false;
  video.volume = 1;
  let source;
  try {
    source = ctx.createMediaElementSource(video);
  } catch {
    // If a browser has already attached this element, its native audio path remains usable.
    return;
  }
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 8;
  compressor.ratio.value = 2.2;
  compressor.attack.value = 0.012;
  compressor.release.value = 0.3;

  const clarity = ctx.createBiquadFilter();
  clarity.type = 'highshelf';
  clarity.frequency.value = 4200;
  clarity.gain.value = 1.05;

  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 1850;
  presence.Q.value = 0.78;
  presence.gain.value = 1.15;

  // Preserve stereo dialogue/transients while anchoring most energy behind the IMAX screen.
  const dry = ctx.createGain();
  dry.gain.value = 0.42;
  const frontPanner = makeCinemaPanner(ctx, 0, SCREEN_Y, SCREEN_Z + 0.18, 30, 'HRTF');
  const frontGain = ctx.createGain();
  frontGain.gain.value = 0.68;
  const bass = ctx.createBiquadFilter();
  bass.type = 'lowpass';
  bass.frequency.value = 125;
  bass.Q.value = 0.72;
  const bassGain = ctx.createGain();
  bassGain.gain.value = 0.32;

  const convolver = ctx.createConvolver();
  const impulseLength = Math.floor(ctx.sampleRate * 0.68);
  const impulse = ctx.createBuffer(2, impulseLength, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < impulseLength; i++) {
      const decay = Math.pow(1 - i / impulseLength, 3.6);
      data[i] = (Math.random() * 2 - 1) * decay * (i < 1800 ? 0.7 : 0.22);
    }
  }
  convolver.buffer = impulse;
  const room = ctx.createGain();
  room.gain.value = 0.052;
  movieMaster = ctx.createGain();
  movieMaster.gain.value = 0.94;

  source.connect(clarity).connect(presence).connect(compressor);
  compressor.connect(dry).connect(movieMaster);
  compressor.connect(frontPanner).connect(frontGain).connect(movieMaster);
  compressor.connect(bass).connect(bassGain).connect(movieMaster);
  compressor.connect(convolver).connect(room).connect(movieMaster);

  // Low-level HRTF feeds approximate the side, rear, and overhead arrays visible in the hall.
  const surroundSpecs = [
    { position: [-19, 8.5, 2], delay: 0.024, gain: 0.078, model: 'HRTF' },
    { position: [19, 8.5, 2], delay: 0.032, gain: 0.078, model: 'HRTF' },
    { position: [-14, 10.5, 25], delay: 0.046, gain: 0.06, model: 'HRTF' },
    { position: [14, 10.5, 25], delay: 0.058, gain: 0.06, model: 'HRTF' },
    { position: [-7, 19, 6], delay: 0.036, gain: 0.046, model: 'equalpower' },
    { position: [7, 19, 6], delay: 0.042, gain: 0.046, model: 'equalpower' },
  ];
  for (const spec of surroundSpecs) {
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = spec.delay;
    const gain = ctx.createGain();
    gain.gain.value = spec.gain;
    const panner = makeCinemaPanner(ctx, ...spec.position, 22, spec.model);
    compressor.connect(delay).connect(panner).connect(gain).connect(movieMaster);
  }
  const peakLimiter = ctx.createDynamicsCompressor();
  peakLimiter.threshold.value = -2.2;
  peakLimiter.knee.value = 0;
  peakLimiter.ratio.value = 20;
  peakLimiter.attack.value = 0.002;
  peakLimiter.release.value = 0.12;
  movieMaster.connect(peakLimiter).connect(ctx.destination);
  movieAudioReady = true;
}

let lastCinemaListenerUpdate = 0;
function updateCinemaListener(nowMs) {
  if (!movieAudioReady || !audioContext) return;
  // HRTF listener transforms do not need display-refresh frequency. Updating at 30 Hz
  // remains smooth to the ear and prevents an ever-growing AudioParam automation queue.
  if (nowMs - lastCinemaListenerUpdate < 33) return;
  lastCinemaListenerUpdate = nowMs;
  const listener = audioContext.listener;
  camera.getWorldDirection(tempVector);
  const now = audioContext.currentTime;
  if (listener.positionX) {
    for (const parameter of [
      listener.positionX, listener.positionY, listener.positionZ,
      listener.forwardX, listener.forwardY, listener.forwardZ,
      listener.upX, listener.upY, listener.upZ,
    ]) parameter.cancelScheduledValues(now);
    listener.positionX.setTargetAtTime(camera.position.x, now, 0.025);
    listener.positionY.setTargetAtTime(camera.position.y, now, 0.025);
    listener.positionZ.setTargetAtTime(camera.position.z, now, 0.025);
    listener.forwardX.setTargetAtTime(tempVector.x, now, 0.025);
    listener.forwardY.setTargetAtTime(tempVector.y, now, 0.025);
    listener.forwardZ.setTargetAtTime(tempVector.z, now, 0.025);
    listener.upX.setTargetAtTime(0, now, 0.025);
    listener.upY.setTargetAtTime(1, now, 0.025);
    listener.upZ.setTargetAtTime(0, now, 0.025);
  } else {
    listener.setPosition(camera.position.x, camera.position.y, camera.position.z);
    listener.setOrientation(tempVector.x, tempVector.y, tempVector.z, 0, 1, 0);
  }
}

function groundHeightAt(z, x = camera.position.x) {
  if (x < -19.2) return 0;
  if (z > 22.25) return REAR_LANDING_Y;
  const row = [...ROWS].reverse().find((item) => z > item.z - 1.62);
  return row ? row.y : 0;
}

function collidesWithSeat(position) {
  if (Math.abs(position.x) < 1.32 || Math.abs(position.x) > 17.15) return false;
  return ROWS.some((row) => Math.abs(position.z - row.z) < 0.78)
    && SEAT_XS.some((x) => Math.abs(position.x - x) < 0.7);
}

function collidesWithArchitecture(position) {
  const inSideDoor = position.z > LEFT_ENTRANCE_FRONT_Z + 0.18
    && position.z < LEFT_ENTRANCE_REAR_Z - 0.18;

  // The solid left auditorium wall is passable only at the front side door.
  if (position.x > -20.72 && position.x < -18.7 && !inSideDoor) return true;

  if (position.x > -19.2) {
    if (position.x > 18.72 || position.z < -26.25 || position.z > 26.72) return true;
    if (position.x < -18.72 && !inSideDoor) return true;
  } else {
    // Compact lobby and its side sound lock have intentionally tight boundaries.
    if (position.x < -51.55 || position.z < -25.45 || position.z > 9.28) return true;
  }
  return position.x < -18.7 && lobby.collides(position);
}

function isValidSeatApproach(seat) {
  if (!seat || state.seated || state.action) return false;
  const dx = camera.position.x - seat.x;
  const dz = camera.position.z - seat.z;
  const distance = Math.hypot(dx, dz);
  const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), seat.yaw ?? 0);
  const inFront = dx * forward.x + dz * forward.z > 0.35;
  const matchingLevel = Math.abs(camera.position.y - (seat.y + 1.7)) < 1.05;
  return inFront && matchingLevel && distance < 3.75;
}

function getGazeHit() {
  raycaster.setFromCamera(centerPointer, camera);
  const lobbySeatTargets = lobbyAttached ? lobby.seatMeshes : [];
  const lobbyInteractionTargets = lobbyAttached ? lobby.interactionMeshes : [];
  const targets = seatParts.map((part) => part.mesh).concat(lobbySeatTargets, lobbyInteractionTargets, [terminalBody, terminalScreen]);
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return null;
  if (hit.object.userData.lobbySeat) return { type: 'seat', seat: hit.object.userData.lobbySeat, distance: hit.distance };
  if (hit.object.userData.seatInstances && Number.isInteger(hit.instanceId)) return { type: 'seat', seat: seats[hit.instanceId], distance: hit.distance };
  if (hit.object.userData.terminal) return { type: 'terminal', distance: hit.distance };
  if (hit.object.userData.lobbyInteraction) return { type: 'lobby-interaction', interaction: hit.object.userData.lobbyInteraction, distance: hit.distance };
  return null;
}

function updateGaze() {
  if (!state.locked || state.remoteRaised || state.kioskActive || state.action) {
    if (state.gazeSeat) { state.gazeSeat = null; refreshSeatColors(); }
    state.gazeTerminal = false;
    state.gazeLobbyInteraction = null;
    return;
  }
  const hit = getGazeHit();
  const nextSeat = hit?.type === 'seat' && isValidSeatApproach(hit.seat) ? hit.seat : null;
  if (nextSeat !== state.gazeSeat) {
    state.gazeSeat = nextSeat;
    refreshSeatColors();
  }
  const previousTerminalState = state.gazeTerminal;
  state.gazeTerminal = hit?.type === 'terminal' && hit.distance < 3.2;
  state.gazeLobbyInteraction = hit?.type === 'lobby-interaction' && hit.distance < 3.35 ? hit.interaction : null;
  terminalScreenMaterial.color.setHex(state.gazeTerminal ? 0xc9fff0 : 0xffffff);
  if (previousTerminalState !== state.gazeTerminal) drawTerminal(state.gazeTerminal);
}

function shortestAngle(from, to) {
  let difference = (to - from + Math.PI) % (Math.PI * 2) - Math.PI;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return from + difference;
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function beginSit(seat) {
  if (!isValidSeatApproach(seat)) return;
  const distance = Math.hypot(camera.position.x - seat.x, camera.position.z - seat.z);
  const destinationYaw = shortestAngle(state.yaw, seat.yaw ?? 0);
  const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), seat.yaw ?? 0);
  const approachDistance = seat.kind === 'lobby' ? 1.55 : 1.08;
  const standingEye = seat.y + 1.72;
  const seatedEye = seat.y + (seat.eyeHeight ?? 1.58);
  state.action = {
    type: 'sit',
    seat,
    start: performance.now(),
    duration: THREE.MathUtils.clamp(1650 + distance * 250, 1850, 2500),
    from: camera.position.clone(),
    approach: new THREE.Vector3(seat.x + forward.x * approachDistance, standingEye, seat.z + forward.z * approachDistance),
    seated: new THREE.Vector3(seat.x + forward.x * 0.18, seatedEye, seat.z + forward.z * 0.18),
    yawFrom: state.yaw,
    yawTo: destinationYaw,
    pitchFrom: state.pitch,
  };
  state.gazeSeat = null;
  state.seat = seat;
  refreshSeatColors();
}

function beginStand() {
  if (!state.seated || state.action || !state.seat) return;
  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(up, state.seat.yaw ?? 0);
  const exitDistance = state.seat.kind === 'lobby' ? 1.65 : 1.1;
  // Prefer the natural straight-ahead exit, then fan slightly to either side.
  // This protects lounge/game seats from leaving the player inside a table,
  // another chair, or a wall as the lobby layout evolves.
  const exitAngles = [0, Math.PI / 7, -Math.PI / 7, Math.PI / 3.5, -Math.PI / 3.5];
  let exitPosition = null;
  for (const angle of exitAngles) {
    const direction = forward.clone().applyAxisAngle(up, angle);
    const candidate = new THREE.Vector3(
      state.seat.x + direction.x * exitDistance,
      state.seat.y + 1.72,
      state.seat.z + direction.z * exitDistance,
    );
    if (!collidesWithSeat(candidate) && !collidesWithArchitecture(candidate)) {
      exitPosition = candidate;
      break;
    }
  }
  exitPosition ??= new THREE.Vector3(
    state.seat.x + forward.x * exitDistance,
    state.seat.y + 1.72,
    state.seat.z + forward.z * exitDistance,
  );
  state.action = {
    type: 'stand',
    seat: state.seat,
    start: performance.now(),
    duration: 900,
    from: camera.position.clone(),
    to: exitPosition,
    pitchFrom: state.pitch,
  };
}

function updateBodyAction(now) {
  if (!state.action) return;
  const action = state.action;
  const t = Math.min(1, (now - action.start) / action.duration);
  if (action.type === 'sit') {
    if (t < 0.34) {
      const p = easeInOut(t / 0.34);
      camera.position.lerpVectors(action.from, action.approach, p);
      state.pitch = THREE.MathUtils.lerp(action.pitchFrom, -0.04, p);
    } else if (t < 0.76) {
      const p = easeInOut((t - 0.34) / 0.42);
      camera.position.copy(action.approach);
      state.yaw = THREE.MathUtils.lerp(action.yawFrom, action.yawTo, p);
      state.pitch = THREE.MathUtils.lerp(-0.04, 0.02, p);
    } else {
      const p = easeInOut((t - 0.76) / 0.24);
      camera.position.lerpVectors(action.approach, action.seated, p);
      camera.position.y += Math.sin(p * Math.PI) * 0.035;
      state.yaw = action.yawTo;
      state.pitch = THREE.MathUtils.lerp(0.02, 0.105, p);
      camera.rotation.z = Math.sin(p * Math.PI) * -0.018;
    }
    state.targetYaw = state.yaw;
    state.targetPitch = state.pitch;
    if (t >= 1) {
      state.seated = true;
      state.seatedYawCenter = action.yawTo;
      state.action = null;
      camera.rotation.z = 0;
    }
  } else {
    const p = easeInOut(t);
    camera.position.lerpVectors(action.from, action.to, p);
    camera.position.y += Math.sin(p * Math.PI) * 0.045;
    state.pitch = THREE.MathUtils.lerp(action.pitchFrom, -0.035, p);
    state.targetPitch = state.pitch;
    camera.rotation.z = Math.sin(p * Math.PI) * 0.012;
    if (t >= 1) {
      state.seated = false;
      state.action = null;
      state.seat = null;
      state.seatedYawCenter = null;
      refreshSeatColors();
      camera.rotation.z = 0;
    }
  }
}

function updateMovement(dt, now) {
  if (!state.entered || !state.locked || state.action || state.remoteRaised || state.kioskActive) { state.moving = false; return; }
  if (state.seated) { state.moving = false; return; }
  const direction = new THREE.Vector3();
  if (keys.has('KeyW') || keys.has('ArrowUp')) direction.z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) direction.z += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) direction.x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) direction.x += 1;
  state.moving = direction.lengthSq() > 0;
  if (!state.moving) return;

  direction.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);
  const speed = keys.has('ShiftLeft') ? 6.4 : 4.25;
  const candidate = camera.position.clone().addScaledVector(direction, speed * dt);
  candidate.x = THREE.MathUtils.clamp(candidate.x, -51.55, 18.72);
  candidate.z = THREE.MathUtils.clamp(candidate.z, -26.25, 26.72);

  if (!collidesWithSeat(candidate) && !collidesWithArchitecture(candidate) && !(Math.hypot(candidate.x, candidate.z + 24.15) < 1.25)) {
    camera.position.x = candidate.x;
    camera.position.z = candidate.z;
    const newGround = groundHeightAt(candidate.z, candidate.x);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, newGround + 1.7, Math.min(1, dt * 10));
    state.bobTime += dt * (keys.has('ShiftLeft') ? 12.5 : 9.4);
    camera.position.y += Math.sin(state.bobTime) * 0.009;
  }
}

function enterKioskMode() {
  if (isInsideAuditorium() || state.kioskActive) return;
  state.kioskActive = true;
  state.kioskHover = null;
  state.gazeLobbyInteraction = null;
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  document.body.classList.remove('is-locked');
  document.body.style.cursor = 'crosshair';
}

function exitKioskMode() {
  if (!state.kioskActive) return;
  state.kioskActive = false;
  state.kioskHover = null;
  lobby.setKioskHover(null);
  document.body.style.cursor = 'crosshair';
  requestImmersiveLock();
}

function interact() {
  if (state.remoteRaised || state.kioskActive) return;
  if (state.gazeLobbyInteraction === 'ticket-kiosk') { enterKioskMode(); return; }
  if (state.gazeSeat) beginSit(state.gazeSeat);
  else if (state.gazeTerminal) openSourcePicker();
}

function toggleLights() {
  state.lightsOn = !state.lightsOn;
  drawRemote(performance.now(), true);
}

function setPlaying(value) {
  state.playing = value;
  if (state.hasVideo) {
    if (value) {
      const ctx = ensureAudio();
      video.muted = false;
      video.volume = 1;
      const startVideo = () => video.play().catch(() => {});
      if (ctx.state === 'running') startVideo();
      else ctx.resume().then(startVideo).catch(startVideo);
    } else video.pause();
  } else {
    drawScreen(value ? 'film' : 'waiting', performance.now());
  }
  syncLobbyRendering();
  drawTerminal(state.gazeTerminal);
  drawRemote(performance.now(), true);
}

function togglePlaying() { setPlaying(!state.playing); }

function stopPlaying() {
  setPlaying(false);
  if (state.hasVideo) video.currentTime = 0;
  else drawScreen('waiting');
}

function openSourcePicker() {
  ensureAudio();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  fileInput.click();
}

let localVideoUrl = '';
let videoTexture;

function configurePlaybackRenderBudget() {
  const sourcePixels = Math.max(1, video.videoWidth * video.videoHeight);
  // Preserve at least native CSS-pixel sharpness. Even 4K playback only trims excess
  // device-pixel supersampling, never the visible 1:1 presentation resolution.
  const sourceCap = sourcePixels > 5_000_000 ? 1.08 : sourcePixels > 2_300_000 ? 1.12 : nativeRenderPixelRatio;
  playbackPixelRatioCeiling = Math.min(nativeRenderPixelRatio, sourceCap);
  setRenderPixelRatio(playbackPixelRatioCeiling);
}

function loadVideo(file) {
  if (!file) return;
  if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
  localVideoUrl = URL.createObjectURL(file);
  video.dataset.fileName = file.name;
  video.src = localVideoUrl;
  video.preload = 'auto';
  video.load();
  video.addEventListener('loadeddata', () => {
    setupMovieAudio();
    if (videoTexture) videoTexture.dispose();
    videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.generateMipmaps = false;
    screenMaterial.map = videoTexture;
    screenMaterial.needsUpdate = true;
    const videoAspect = video.videoWidth / video.videoHeight;
    // Full-frame presentation: preserve every source pixel and letterbox/pillarbox when needed.
    videoTexture.repeat.set(1, 1);
    videoTexture.offset.set(0, 0);
    if (Number.isFinite(videoAspect) && videoAspect > 0) {
      if (videoAspect > SCREEN_ASPECT) screen.scale.set(1, SCREEN_ASPECT / videoAspect, 1);
      else screen.scale.set(videoAspect / SCREEN_ASPECT, 1, 1);
    } else screen.scale.set(1, 1, 1);
    screen.updateMatrixWorld(true);
    configurePlaybackRenderBudget();
    state.hasVideo = true;
    setPlaying(true);
    drawTerminal(state.gazeTerminal);
  }, { once: true });
}

function toggleRemote() {
  if (!isInsideAuditorium()) return;
  if (state.remoteHidden) {
    state.remoteHidden = false;
    state.remoteRaised = true;
  } else {
    state.remoteRaised = !state.remoteRaised;
  }
  if (state.remoteRaised) {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    document.body.classList.remove('is-locked');
  } else {
    state.remoteHover = null;
    refreshRemoteButtons();
    requestImmersiveLock();
  }
  drawRemote(performance.now(), true);
}

function toggleRemoteHidden() {
  if (!isInsideAuditorium()) return;
  state.remoteHidden = !state.remoteHidden;
  if (state.remoteHidden && state.remoteRaised) {
    state.remoteRaised = false;
    state.remoteHover = null;
    refreshRemoteButtons();
    requestImmersiveLock();
  }
  drawRemote(performance.now(), true);
}

function toggleTicketRaised() {
  if (isInsideAuditorium() || !lobby.hasTicket()) return;
  if (state.ticketHidden) {
    state.ticketHidden = false;
    state.ticketRaised = true;
    ticketHand.visible = true;
  } else state.ticketRaised = !state.ticketRaised;
}

function toggleTicketHidden() {
  if (isInsideAuditorium() || !lobby.hasTicket()) return;
  state.ticketHidden = !state.ticketHidden;
  if (!state.ticketHidden) ticketHand.visible = true;
  if (state.ticketHidden) state.ticketRaised = false;
}

function enterScene() {
  if (state.entered) return;
  state.entered = true;
  state.entranceHint = false;
  drawScreen('waiting');
}

function requestImmersiveLock() {
  enterScene();
  lobby.unlockMusic();
  try {
    const request = canvas.requestPointerLock?.();
    if (request?.catch) {
      request.catch(() => {
        // Automated browsers and embedded webviews may reject Pointer Lock.
        // Mouse movement still supplies deltas, so keep the same first-person controls.
        state.locked = true;
        document.body.classList.add('is-locked');
      });
    }
  } catch {
    state.locked = true;
    document.body.classList.add('is-locked');
  }
}

function refreshRemoteButtons() {
  for (const item of remoteButtons) {
    item.material.color.copy(item.color);
    if (state.remoteHover === item.action) item.material.color.lerp(new THREE.Color(0xffffff), 0.42);
  }
}

function raycastRemote(event, activate = false) {
  if (!isInsideAuditorium()) return;
  const rect = canvas.getBoundingClientRect();
  freePointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  freePointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  camera.updateMatrixWorld(true);
  remote.updateMatrixWorld(true);
  raycaster.setFromCamera(freePointer, camera);
  const targets = remoteButtons.flatMap((item) => [item.button, item.label]);
  const hit = raycaster.intersectObjects(targets, false)[0];
  const action = hit?.object.userData.remoteAction || null;
  if (state.remoteHover !== action) {
    state.remoteHover = action;
    refreshRemoteButtons();
  }
  document.body.style.cursor = action ? 'pointer' : 'crosshair';
  if (!activate || !action) return;
  if (action === 'lights') toggleLights();
  if (action === 'play') togglePlaying();
  if (action === 'stop') stopPlaying();
  if (action === 'source') openSourcePicker();
}

function raycastKiosk(event, activate = false) {
  if (!state.kioskActive) return;
  const rect = canvas.getBoundingClientRect();
  freePointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  freePointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  camera.updateMatrixWorld(true);
  lobby.kioskScreen.updateMatrixWorld(true);
  raycaster.setFromCamera(freePointer, camera);
  const hit = raycaster.intersectObject(lobby.kioskScreen, false)[0];
  const action = hit ? lobby.kioskActionAt(hit.uv) : null;
  if (state.kioskHover !== action) {
    state.kioskHover = action;
    lobby.setKioskHover(action);
  }
  document.body.style.cursor = action ? 'pointer' : 'crosshair';
  if (!activate || !action) return;
  const result = lobby.activateKioskAction(action);
  if (result.type === 'printed') {
    state.ticketHidden = false;
    state.ticketRaised = false;
    ticketHand.visible = true;
    exitKioskMode();
  } else if (result.type === 'exit') exitKioskMode();
}

canvas.addEventListener('click', (event) => {
  ensureAudio();
  if (state.kioskActive) { raycastKiosk(event, true); return; }
  if (state.remoteRaised) { raycastRemote(event, true); return; }
  if (document.pointerLockElement !== canvas) {
    requestImmersiveLock();
    return;
  }
  interact();
});

canvas.addEventListener('pointermove', (event) => {
  if (state.kioskActive) { raycastKiosk(event, false); return; }
  if (state.remoteRaised) raycastRemote(event, false);
});

document.addEventListener('pointerlockchange', () => {
  state.locked = document.pointerLockElement === canvas;
  document.body.classList.toggle('is-locked', state.locked);
  if (state.locked) enterScene();
});

document.addEventListener('mousemove', (event) => {
  if (!state.locked || state.remoteRaised || state.kioskActive || state.action) return;
  const requestedYaw = state.targetYaw - event.movementX * 0.00185;
  if (state.seated && state.seat?.kind === 'lobby' && state.seatedYawCenter != null) {
    const offset = Math.atan2(
      Math.sin(requestedYaw - state.seatedYawCenter),
      Math.cos(requestedYaw - state.seatedYawCenter),
    );
    state.targetYaw = state.seatedYawCenter + THREE.MathUtils.clamp(offset, -1.48, 1.48);
  } else state.targetYaw = requestedYaw;
  state.targetPitch -= event.movementY * 0.00165;
  const pitchLimit = state.seated && state.seat?.kind === 'lobby' ? [-0.54, 0.5] : [-0.7, 0.62];
  state.targetPitch = THREE.MathUtils.clamp(state.targetPitch, pitchLimit[0], pitchLimit[1]);
});

window.addEventListener('keydown', (event) => {
  ensureAudio();
  if (event.code === 'Escape' && state.kioskActive) { exitKioskMode(); return; }
  if (event.code === 'Escape' && state.ticketRaised) { state.ticketRaised = false; return; }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code) && state.seated) beginStand();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'KeyE') {
    if (state.kioskActive) exitKioskMode();
    else interact();
  }
  if (event.code === 'KeyR' && isInsideAuditorium()) toggleRemote();
  if (event.code === 'KeyH' && isInsideAuditorium()) toggleRemoteHidden();
  if (event.code === 'KeyR' && !isInsideAuditorium()) toggleTicketRaised();
  if (event.code === 'KeyH' && !isInsideAuditorium()) toggleTicketHidden();
  if (event.code === 'KeyL' && isInsideAuditorium()) toggleLights();
  if (event.code === 'KeyU' && isInsideAuditorium()) openSourcePicker();
  if (event.code === 'KeyX' && isInsideAuditorium()) stopPlaying();
  if (event.code === 'Space' && isInsideAuditorium()) { event.preventDefault(); togglePlaying(); }
});
window.addEventListener('keyup', (event) => keys.delete(event.code));

fileInput.addEventListener('change', () => loadVideo(fileInput.files?.[0]));
video.addEventListener('ended', () => setPlaying(false));

let lastGazeUpdate = 0;
let lastRenderedAt = 0;
const remoteDownPosition = new THREE.Vector3(0.46, -0.35, -0.72);
const remoteRaisedPosition = new THREE.Vector3(0.38, -0.04, -0.72);
const remoteHiddenPosition = new THREE.Vector3(0.62, -0.86, -0.72);
const remoteDownRotation = new THREE.Euler(-0.16, -0.24, -0.05);
const remoteRaisedRotation = new THREE.Euler(-0.02, -0.1, -0.025);
const remoteDownScale = new THREE.Vector3(0.58, 0.58, 0.58);
const remoteRaisedScale = new THREE.Vector3(0.9, 0.9, 0.9);
const remoteHiddenScale = new THREE.Vector3(0.34, 0.34, 0.34);
const ticketDownPosition = new THREE.Vector3(0.1, -0.25, -0.72);
const ticketRaisedPosition = new THREE.Vector3(0, -0.02, -0.72);
const ticketHiddenPosition = new THREE.Vector3(0.62, -0.84, -0.72);
const ticketDownRotation = new THREE.Euler(-0.16, -0.16, -0.04);
const ticketRaisedRotation = new THREE.Euler(-0.015, -0.055, -0.012);
const ticketDownScale = new THREE.Vector3(0.48, 0.48, 0.48);
const ticketRaisedScale = new THREE.Vector3(0.72, 0.72, 0.72);
const ticketHiddenScale = new THREE.Vector3(0.32, 0.32, 0.32);
const aisleLightOn = new THREE.Color(0xd27b36);
const aisleLightOff = new THREE.Color(0x6d2b19);
const ceilingFixtureOn = new THREE.Color(0xffddb7);
const ceilingFixtureOff = new THREE.Color(0x2b1d18);
const aisleLightCurrent = new THREE.Color();
function animate(now) {
  requestAnimationFrame(animate);
  // Do not render a 24/30/60 fps movie at 120–240 Hz. The accumulator keeps
  // movement cadence stable across 60/90/120/144 Hz displays without busy GPU work.
  const targetFrameInterval = state.hasVideo && state.playing ? 1000 / 60 : 1000 / 90;
  if (!lastRenderedAt) lastRenderedAt = now - targetFrameInterval;
  const elapsedSinceRender = now - lastRenderedAt;
  if (elapsedSinceRender + 0.5 < targetFrameInterval) return;
  lastRenderedAt += Math.max(targetFrameInterval, Math.floor(elapsedSinceRender / targetFrameInterval) * targetFrameInterval);
  const dt = Math.min(clock.getDelta(), 0.04);

  if (!state.action) {
    const lookSmoothing = 1 - Math.exp(-dt * 24);
    state.yaw = THREE.MathUtils.lerp(state.yaw, state.targetYaw, lookSmoothing);
    state.pitch = THREE.MathUtils.lerp(state.pitch, state.targetPitch, lookSmoothing);
  }
  updateBodyAction(now);
  updateMovement(dt, now);
  syncLobbyRendering();
  remote.visible = isInsideAuditorium() && !state.remoteHidden;
  const ticketAvailable = lobby.hasTicket() && !isInsideAuditorium();
  if (ticketAvailable && !state.ticketHidden) ticketHand.visible = true;
  camera.rotation.y = state.yaw;
  camera.rotation.x = state.pitch;
  camera.updateMatrixWorld(true);
  if (lobbyAttached) lobby.update(now, camera);
  updateCinemaListener(now);

  if (now - lastGazeUpdate > 85) {
    updateGaze();
    lastGazeUpdate = now;
  }

  const raiseEase = 1 - Math.exp(-dt * 11);
  const remoteTargetPosition = state.remoteHidden ? remoteHiddenPosition : state.remoteRaised ? remoteRaisedPosition : remoteDownPosition;
  const remoteTargetRotation = state.remoteRaised ? remoteRaisedRotation : remoteDownRotation;
  const remoteTargetScale = state.remoteHidden ? remoteHiddenScale : state.remoteRaised ? remoteRaisedScale : remoteDownScale;
  remote.position.lerp(remoteTargetPosition, raiseEase);
  remote.rotation.x = THREE.MathUtils.lerp(remote.rotation.x, remoteTargetRotation.x, raiseEase);
  remote.rotation.y = THREE.MathUtils.lerp(remote.rotation.y, remoteTargetRotation.y, raiseEase);
  remote.rotation.z = THREE.MathUtils.lerp(remote.rotation.z, remoteTargetRotation.z, raiseEase);
  remote.scale.lerp(remoteTargetScale, raiseEase);
  remote.updateMatrixWorld(true);

  const ticketTargetPosition = state.ticketHidden ? ticketHiddenPosition : state.ticketRaised ? ticketRaisedPosition : ticketDownPosition;
  const ticketTargetRotation = state.ticketRaised ? ticketRaisedRotation : ticketDownRotation;
  const ticketTargetScale = state.ticketHidden ? ticketHiddenScale : state.ticketRaised ? ticketRaisedScale : ticketDownScale;
  ticketHand.position.lerp(ticketTargetPosition, raiseEase);
  ticketHand.rotation.x = THREE.MathUtils.lerp(ticketHand.rotation.x, ticketTargetRotation.x, raiseEase);
  ticketHand.rotation.y = THREE.MathUtils.lerp(ticketHand.rotation.y, ticketTargetRotation.y, raiseEase);
  ticketHand.rotation.z = THREE.MathUtils.lerp(ticketHand.rotation.z, ticketTargetRotation.z, raiseEase);
  ticketHand.scale.lerp(ticketTargetScale, raiseEase);
  if (!ticketAvailable || (state.ticketHidden && ticketHand.position.y < -0.79)) ticketHand.visible = false;
  ticketHand.updateMatrixWorld(true);

  // A synchronized cinema fade drives every main-light surface over roughly three seconds.
  const lightFadeRate = state.lightsOn ? 2.8 : 5.2;
  const lightFade = 1 - Math.exp(-dt * lightFadeRate);
  state.lightLevel = THREE.MathUtils.lerp(state.lightLevel, state.lightsOn ? 1 : 0, lightFade);
  const lightLevel = state.lightLevel;
  const houseTarget = THREE.MathUtils.lerp(0.3, 0.55, lightLevel);
  const rowTarget = THREE.MathUtils.lerp(0.2, 0.55, lightLevel);
  for (const light of houseLights) light.intensity = houseTarget;
  for (const material of houseLightMaterials) material.emissiveIntensity = THREE.MathUtils.lerp(0.2, 0.42, lightLevel);
  for (const light of rowLights) light.intensity = rowTarget;
  aisleLightCurrent.copy(aisleLightOff).lerp(aisleLightOn, 0.45 + lightLevel * 0.55);
  for (const led of aisleLights) led.material.color.copy(aisleLightCurrent);
  ceilingFixtureMaterial.color.copy(ceilingFixtureOff).lerp(ceilingFixtureOn, lightLevel);
  hemisphereLight.intensity = THREE.MathUtils.lerp(0.58, 2.6, lightLevel);
  auditoriumAmbient.intensity = THREE.MathUtils.lerp(0.26, 1.4, lightLevel);
  mainLightFront.intensity = THREE.MathUtils.lerp(0.04, 3.5, lightLevel);
  mainLightRear.intensity = THREE.MathUtils.lerp(0.03, 2.4, lightLevel);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(0.9, 1.2, lightLevel);
  screenBounce.intensity = THREE.MathUtils.lerp(screenBounce.intensity, state.playing ? 5.2 : 3.4, dt * 2);

  if (state.playing && !state.hasVideo && now - lastRemoteDraw > 220) drawScreen('film', now);
  drawRemote(now);
  terminalGlow.intensity = 0.65 + Math.sin(now * 0.003) * 0.1;

  renderer.render(scene, camera);

  // The playback pixel ratio is fixed for the lifetime of the loaded source.
  // Reallocating the WebGL canvas mid-film causes a visible one-frame flash on some GPUs.
}
// All auditorium architecture is static. Keep its world matrices cached and update only
// the moving camera/remote hierarchy each frame.
scene.updateMatrixWorld(true);
scene.matrixWorldAutoUpdate = false;
requestAnimationFrame(animate);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(renderPixelRatio);
});

window.addEventListener('beforeunload', () => {
  if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
});
