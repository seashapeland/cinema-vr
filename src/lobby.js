import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createTicketingSystem } from './ticketing.js';
import { loadCinemaConfig, resolveCinemaText } from './cinemaConfig.js';

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  draw(context, canvas, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { canvas, context, texture, draw };
}

function labelTexture(title, subtitle = '', accent = '#70d9ff') {
  return canvasTexture(1024, 256, (ctx, canvas) => {
    const glow = ctx.createLinearGradient(0, 0, canvas.width, 0);
    glow.addColorStop(0, '#071019');
    glow.addColorStop(0.5, '#10283b');
    glow.addColorStop(1, '#071019');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = '700 68px Arial, "Microsoft YaHei", sans-serif';
    ctx.fillText(title, canvas.width / 2, 113);
    if (subtitle) {
      ctx.fillStyle = '#d5e3e9';
      ctx.font = '500 24px Arial, "Microsoft YaHei", sans-serif';
      ctx.fillText(subtitle, canvas.width / 2, 174);
    }
  }).texture;
}

function trailerPlaceholder(index) {
  const titles = ['BEYOND THE FRAME', 'MIDNIGHT SIGNAL', 'THE LAST ORBIT', 'MEMORY OF LIGHT'];
  const colors = [['#0b3554', '#16384f'], ['#3c1833', '#101d43'], ['#54271c', '#17162e'], ['#183e38', '#20234f']];
  return canvasTexture(960, 540, (ctx, canvas, time) => {
    const shift = (time * 0.00006 + index * 0.19) % 1;
    const [left, right] = colors[index % colors.length];
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, left);
    gradient.addColorStop(1, right);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#6ed9ff';
    ctx.beginPath();
    ctx.arc(canvas.width * (0.14 + shift * 0.72), 190, 135, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(2,8,15,.76)';
    ctx.fillRect(0, 336, canvas.width, 204);
    ctx.fillStyle = '#f3f7fa';
    ctx.font = '700 48px Arial, sans-serif';
    ctx.fillText(titles[index % titles.length], 48, 408);
    ctx.fillStyle = '#80dfff';
    ctx.font = '600 20px Arial, sans-serif';
    ctx.fillText('NOW SHOWING  /  PREMIUM LARGE FORMAT', 50, 456);
  });
}

function makeLobbyFloor(renderer) {
  const surface = canvasTexture(512, 512, (ctx, canvas) => {
    ctx.fillStyle = '#d4c9bb';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sheen = ctx.createLinearGradient(0, 0, 512, 512);
    sheen.addColorStop(0, 'rgba(255,250,242,.07)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(126,108,91,.07)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, 512, 512);
    let seed = 91;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let index = 0; index < 900; index++) {
      const value = 120 + Math.floor(random() * 65);
      ctx.fillStyle = `rgba(${value},${value},${value},.055)`;
      ctx.fillRect(random() * 512, random() * 512, random() * 1.4 + 0.3, random() * 1.4 + 0.3);
    }
    ctx.strokeStyle = 'rgba(104,91,79,.34)';
    ctx.lineWidth = 3;
    for (let line = 0; line <= 512; line += 128) {
      ctx.beginPath();
      ctx.moveTo(line, 0);
      ctx.lineTo(line, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, line);
      ctx.lineTo(512, line);
      ctx.stroke();
    }
  }).texture;
  surface.wrapS = surface.wrapT = THREE.RepeatWrapping;
  surface.repeat.set(7.5, 9);
  surface.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return new THREE.MeshStandardMaterial({ color: 0xc7bbac, map: surface, roughness: 0.86, metalness: 0.008 });
}

export function createCinemaLobby({ materials, floorY = 0, renderer }) {
  const root = new THREE.Group();
  root.name = 'compact-side-lobby';
  const colliders = [];
  const posterSlots = [];
  const standeeSlots = [];
  const trailerSlots = [];
  const trailerCanvases = [];
  const mediaChannels = [];
  const seatMeshes = [];
  const configurableLabels = [];
  const lobbyMusic = document.createElement('audio');
  lobbyMusic.loop = true;
  lobbyMusic.preload = 'metadata';
  lobbyMusic.volume = 1;
  let mediaActive = true;
  let musicActive = false;
  let musicUnlocked = false;
  let lastTrailerDraw = 0;
  let lobbyAudioContext;
  let lobbyAudioMaster;
  let lobbyOcclusionFilter;
  let lobbyMusicBus;
  let lobbyMusicSource;
  let configuredMusicVolume = 0.36;
  let acousticExposure = 1;
  let lastAppliedExposure = -1;
  let lastListenerUpdate = 0;
  const lobbyAudioForward = new THREE.Vector3();

  const configurableLabelMaterial = (key, title, subtitle = '', accent = '#70d9ff') => {
    const material = new THREE.MeshBasicMaterial({ map: labelTexture(title, subtitle, accent), toneMapped: false });
    configurableLabels.push({ key, title, subtitle, accent, material });
    return material;
  };

  const applyConfiguredLabels = (config) => {
    const cinemaName = String(config.cinemaName || 'VELVET 07');
    const labels = config.labels ?? {};
    for (const entry of configurableLabels) {
      const configured = labels[entry.key] ?? {};
      const title = resolveCinemaText(configured.title, entry.title, cinemaName);
      const subtitle = resolveCinemaText(configured.subtitle, entry.subtitle, cinemaName);
      const accent = String(configured.accent || entry.accent);
      entry.material.map?.dispose();
      entry.material.map = labelTexture(title, subtitle, accent);
      entry.material.needsUpdate = true;
    }
  };

  const setAudioPosition = (node, position) => {
    if (node.positionX) {
      node.positionX.value = position.x;
      node.positionY.value = position.y;
      node.positionZ.value = position.z;
    } else node.setPosition(position.x, position.y, position.z);
  };

  const createLobbyPanner = (position, referenceDistance = 6, rolloff = 0.72) => {
    const panner = lobbyAudioContext.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = referenceDistance;
    panner.maxDistance = 70;
    panner.rolloffFactor = rolloff;
    // Treat modeled lobby speakers as compact point sources. Directional cones
    // require a reliable world-space driver orientation and otherwise cause
    // arbitrary volume changes as the listener walks around a screen.
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 1;
    setAudioPosition(panner, position);
    return panner;
  };

  const connectTrailerChannel = (channel) => {
    if (!lobbyAudioContext || channel.source) return;
    try {
      channel.source = lobbyAudioContext.createMediaElementSource(channel.media);
    } catch {
      return;
    }
    const clarity = lobbyAudioContext.createBiquadFilter();
    clarity.type = 'highpass';
    clarity.frequency.value = 82;
    const soften = lobbyAudioContext.createBiquadFilter();
    soften.type = 'highshelf';
    soften.frequency.value = 6400;
    soften.gain.value = -3.2;
    const compressor = lobbyAudioContext.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 10;
    compressor.ratio.value = 2.4;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.24;
    channel.panner = createLobbyPanner(channel.position, channel.index === 4 ? 7.5 : 5.5, 0.82);
    channel.gain = lobbyAudioContext.createGain();
    channel.gain.gain.value = 0;
    channel.source.connect(clarity).connect(soften).connect(compressor).connect(channel.panner).connect(channel.gain).connect(lobbyAudioMaster);
    channel.media.muted = false;
  };

  const ensureLobbyAudio = () => {
    if (lobbyAudioContext) {
      if (lobbyAudioContext.state === 'suspended') lobbyAudioContext.resume().catch(() => {});
      mediaChannels.forEach(connectTrailerChannel);
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      lobbyAudioContext = new AudioContextClass({ latencyHint: 'interactive' });
    } catch {
      lobbyAudioContext = new AudioContextClass();
    }
    lobbyAudioMaster = lobbyAudioContext.createGain();
    lobbyAudioMaster.gain.value = 0.9;
    lobbyOcclusionFilter = lobbyAudioContext.createBiquadFilter();
    lobbyOcclusionFilter.type = 'lowpass';
    lobbyOcclusionFilter.frequency.value = 14000;
    lobbyOcclusionFilter.Q.value = 0.32;
    const limiter = lobbyAudioContext.createDynamicsCompressor();
    limiter.threshold.value = -3.2;
    limiter.knee.value = 4;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;
    lobbyAudioMaster.connect(lobbyOcclusionFilter).connect(limiter).connect(lobbyAudioContext.destination);

    lobbyMusicBus = lobbyAudioContext.createGain();
    lobbyMusicBus.gain.value = 0;
    lobbyMusicBus.connect(lobbyAudioMaster);
    try {
      lobbyMusicSource = lobbyAudioContext.createMediaElementSource(lobbyMusic);
      const musicTone = lobbyAudioContext.createBiquadFilter();
      musicTone.type = 'highshelf';
      musicTone.frequency.value = 5400;
      musicTone.gain.value = -2.4;
      lobbyMusicSource.connect(musicTone);
      const speakerPositions = [
        new THREE.Vector3(-50.8, floorY + 7.2, -3.2),
        new THREE.Vector3(-31.2, floorY + 7.2, -3.2),
        new THREE.Vector3(-49.2, floorY + 7.2, -17.2),
        new THREE.Vector3(-32.6, floorY + 7.2, -17.2),
      ];
      speakerPositions.forEach((position, index) => {
        const delay = lobbyAudioContext.createDelay(0.05);
        delay.delayTime.value = index * 0.0065;
        const panner = createLobbyPanner(position, 17, 0.22);
        const gain = lobbyAudioContext.createGain();
        gain.gain.value = 0.22;
        musicTone.connect(delay).connect(panner).connect(gain).connect(lobbyMusicBus);
      });
      const impulseLength = Math.floor(lobbyAudioContext.sampleRate * 0.92);
      const impulse = lobbyAudioContext.createBuffer(2, impulseLength, lobbyAudioContext.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let index = 0; index < impulseLength; index++) {
          const decay = Math.pow(1 - index / impulseLength, 2.75);
          data[index] = (Math.random() * 2 - 1) * decay * 0.3;
        }
      }
      const reverb = lobbyAudioContext.createConvolver();
      reverb.buffer = impulse;
      const reverbGain = lobbyAudioContext.createGain();
      reverbGain.gain.value = 0.16;
      musicTone.connect(reverb).connect(reverbGain).connect(lobbyMusicBus);
    } catch {
      lobbyMusicSource = null;
    }
    mediaChannels.forEach(connectTrailerChannel);
    applyLobbyAcoustics(true);
  };

  function applyLobbyAcoustics(force = false) {
    if (!lobbyAudioContext || !lobbyAudioMaster || !lobbyOcclusionFilter) return;
    if (!force && Math.abs(acousticExposure - lastAppliedExposure) < 0.012) return;
    lastAppliedExposure = acousticExposure;
    const time = lobbyAudioContext.currentTime;
    // Crossing the screen-left doorway progressively removes direct sound and
    // high frequencies, producing a believable wall/door isolation transition.
    const output = 0.9 * (0.018 + 0.982 * Math.pow(acousticExposure, 0.78));
    const cutoff = 480 + 13520 * Math.pow(acousticExposure, 1.5);
    lobbyAudioMaster.gain.cancelScheduledValues(time);
    lobbyAudioMaster.gain.setTargetAtTime(output, time, 0.12);
    lobbyOcclusionFilter.frequency.cancelScheduledValues(time);
    lobbyOcclusionFilter.frequency.setTargetAtTime(cutoff, time, 0.16);
  }

  const syncLobbyListener = (now, camera) => {
    if (!lobbyAudioContext || !camera || now - lastListenerUpdate < 45) return;
    lastListenerUpdate = now;
    const listener = lobbyAudioContext.listener;
    camera.getWorldDirection(lobbyAudioForward);
    if (listener.positionX) {
      listener.positionX.value = camera.position.x;
      listener.positionY.value = camera.position.y;
      listener.positionZ.value = camera.position.z;
      listener.forwardX.value = lobbyAudioForward.x;
      listener.forwardY.value = lobbyAudioForward.y;
      listener.forwardZ.value = lobbyAudioForward.z;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else {
      listener.setPosition(camera.position.x, camera.position.y, camera.position.z);
      listener.setOrientation(lobbyAudioForward.x, lobbyAudioForward.y, lobbyAudioForward.z, 0, 1, 0);
    }
  };

  const stopTrailerChannel = (channel, immediate = false) => {
    if (!channel) return;
    if (channel.pauseTimer) clearTimeout(channel.pauseTimer);
    if (channel.gain && lobbyAudioContext) {
      const time = lobbyAudioContext.currentTime;
      channel.gain.gain.cancelScheduledValues(time);
      channel.gain.gain.setTargetAtTime(0, time, immediate ? 0.015 : 0.12);
    }
    const pause = () => {
      channel.media.pause();
      channel.pauseTimer = null;
    };
    if (immediate) pause();
    else channel.pauseTimer = setTimeout(pause, 520);
  };

  const startTrailerChannel = (channel) => {
    if (!channel || !mediaActive) return;
    if (channel.pauseTimer) {
      clearTimeout(channel.pauseTimer);
      channel.pauseTimer = null;
    }
    channel.media.muted = !musicUnlocked;
    channel.media.play().catch(() => {});
    if (channel.gain && lobbyAudioContext) {
      const time = lobbyAudioContext.currentTime;
      channel.gain.gain.cancelScheduledValues(time);
      // Television audio is deliberately local and restrained. The ceiling
      // music remains the dominant foyer layer even when several screens overlap.
      channel.gain.gain.setTargetAtTime(channel.index === 4 ? 0.085 : 0.065, time, 0.2);
    }
  };

  const syncLobbyMusic = () => {
    const shouldPlay = musicActive && musicUnlocked && lobbyMusic.src;
    if (shouldPlay) {
      ensureLobbyAudio();
      lobbyMusic.muted = false;
      lobbyMusic.play().catch(() => {});
    } else lobbyMusic.pause();
    if (lobbyMusicBus && lobbyAudioContext) {
      const time = lobbyAudioContext.currentTime;
      lobbyMusicBus.gain.cancelScheduledValues(time);
      lobbyMusicBus.gain.setTargetAtTime(shouldPlay ? configuredMusicVolume : 0, time, 0.22);
    }
  };

  const addBox = (name, size, position, material, parent = root) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  };
  const addCollider = (x, z, halfX, halfZ) => colliders.push({ x, z, halfX, halfZ });
  const loader = new THREE.TextureLoader();

  const floorMaterial = makeLobbyFloor(renderer);
  const wallSurface = canvasTexture(512, 512, (ctx, canvas) => {
    ctx.fillStyle = '#777b7f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let x = 0; x < canvas.width; x += 5) {
      ctx.fillStyle = x % 10 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.045)';
      ctx.fillRect(x, 0, 1, canvas.height);
    }
    for (let y = 0; y < canvas.height; y += 128) {
      ctx.fillStyle = 'rgba(8,12,16,.12)';
      ctx.fillRect(0, y, canvas.width, 2);
    }
  }).texture;
  wallSurface.wrapS = wallSurface.wrapT = THREE.RepeatWrapping;
  wallSurface.repeat.set(2, 5);
  wallSurface.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const ivory = new THREE.MeshStandardMaterial({ color: 0xd9d0c4, roughness: 0.9 });
  const ceilingWarmWhite = new THREE.MeshStandardMaterial({ color: 0xd4e0e2, roughness: 0.92 });
  const silver = new THREE.MeshStandardMaterial({ color: 0x68737a, roughness: 0.32, metalness: 0.64 });
  const charcoal = new THREE.MeshStandardMaterial({ color: 0x171d23, map: wallSurface, bumpMap: wallSurface, bumpScale: 0.012, roughness: 0.76, metalness: 0.12 });
  const graphite = new THREE.MeshStandardMaterial({ color: 0x343b40, map: wallSurface, bumpMap: wallSurface, bumpScale: 0.01, roughness: 0.9 });
  const blueFabric = new THREE.MeshStandardMaterial({ color: 0x253c50, roughness: 0.92 });
  const paleFabric = new THREE.MeshStandardMaterial({ color: 0xaeb9c1, roughness: 0.94 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fc6d0, roughness: 0.09, metalness: 0.04, transparent: true, opacity: 0.08 });
  const darkGlass = new THREE.MeshPhysicalMaterial({ color: 0x183344, roughness: 0.14, metalness: 0.28, transparent: true, opacity: 0.78 });
  const cyan = new THREE.MeshStandardMaterial({ color: 0x75dcff, emissive: 0x179fd5, emissiveIntensity: 2.4, roughness: 0.3 });
  const whiteGlow = new THREE.MeshBasicMaterial({ color: 0xffeee0, toneMapped: false });
  const blackScreen = new THREE.MeshBasicMaterial({ color: 0x03070b, toneMapped: false });
  const kioskScreenMaterial = new THREE.MeshBasicMaterial({ color: 0x0a1724, toneMapped: false });
  const gameScreenMaterial = new THREE.MeshBasicMaterial({ color: 0x0a1724, toneMapped: false });
  const ticketing = createTicketingSystem({ renderer });
  kioskScreenMaterial.map = ticketing.screenTexture;
  kioskScreenMaterial.color.setHex(0xffffff);

  // Compact side foyer, matching the user's plan: entrance at the front, counter
  // at the back, ticket-controlled sound lock on the right.
  addBox('lobby-floor', [31, 0.26, 36], [-36.5, floorY - 0.16, -8], floorMaterial);
  addBox('lobby-ceiling', [31, 0.28, 36], [-36.5, floorY + 9.65, -8], ceilingWarmWhite);
  addBox('lobby-left-wall', [0.38, 9.8, 36], [-52, floorY + 4.8, -8], graphite);
  addBox('lobby-back-wall', [31, 10.6, 0.38], [-36.5, floorY + 5.2, -25.9], graphite);
  addBox('left-media-wood-panel', [0.18, 8.4, 17.2], [-51.76, floorY + 4.2, -4.2], materials.wood);
  for (const z of [-12.5, -3.7, 4.3]) addBox('left-media-panel-trim', [0.12, 8.5, 0.08], [-51.64, floorY + 4.2, z], silver);

  // Fully modeled exterior: a compact plaza and a layered commercial skyline.
  // No image plane is used, so there is nothing that can bleed into the hall.
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDirection;
      float hash(vec2 value) {
        return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453);
      }
      void main() {
        float altitude = vDirection.y;
        vec3 horizon = vec3(0.055, 0.115, 0.205);
        vec3 zenith = vec3(0.006, 0.012, 0.042);
        vec3 below = vec3(0.012, 0.024, 0.052);
        vec3 sky = mix(horizon, zenith, smoothstep(0.01, 0.82, altitude));
        sky = mix(below, sky, smoothstep(-0.24, 0.02, altitude));
        float haze = exp(-abs(altitude) * 19.0) * 0.075;
        sky += vec3(0.14, 0.105, 0.085) * haze;
        vec2 starCell = floor(vDirection.xz * 880.0);
        float stars = step(0.9978, hash(starCell)) * smoothstep(0.12, 0.55, altitude);
        sky += vec3(0.72, 0.82, 1.0) * stars * 0.72;
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(88, 32, 18), skyMaterial);
  skyDome.name = 'procedural-blue-hour-skybox';
  skyDome.position.set(-36.5, floorY, 20);
  skyDome.renderOrder = -100;
  root.add(skyDome);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffe8c7, toneMapped: false }));
  moon.name = 'exterior-moon';
  moon.position.set(-49, floorY + 17.5, 46);
  root.add(moon);

  // Original dual-tail comet: a bright white-gold nucleus, a long cyan trail,
  // a restrained violet split and a sparse field of shed fragments. It moves
  // through the modeled sky rather than being painted onto the skybox, so
  // buildings can naturally silhouette it as it crosses the plaza.
  const meteor = new THREE.Group();
  meteor.name = 'exterior-dual-tail-comet';
  meteor.userData.dynamic = true;
  const meteorMaterials = [];
  const meteorMaterial = (color, opacity) => {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    material.userData.baseOpacity = opacity;
    meteorMaterials.push(material);
    return material;
  };
  const meteorTube = (name, points, radius, material, radialSegments = 7) => {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, radius, radialSegments, false), material);
    mesh.name = name;
    meteor.add(mesh);
    return mesh;
  };
  meteorTube('meteor-cyan-aura', [[0, 0, 0], [6, 2, 0.02], [15, 7, 0.12], [28, 16, 0.42], [44, 30, 1.15]], 0.58, meteorMaterial(0x4ccfff, 0.16));
  meteorTube('meteor-cyan-main-tail', [[0, 0, 0], [6, 1.8, 0.02], [14, 5, 0.12], [26, 12, 0.38], [38, 22, 0.9]], 0.24, meteorMaterial(0x6de4ff, 0.7));
  meteorTube('meteor-white-core-tail', [[0, 0, 0], [5, 1.4, 0], [12, 4, 0.06], [21, 9, 0.2], [31, 15, 0.55]], 0.085, meteorMaterial(0xfff4dc, 0.98), 6);
  meteorTube('meteor-violet-split-tail', [[-0.1, 0.02, -0.04], [5, 3, -0.12], [12, 8, -0.08], [22, 18, 0.3], [34, 32, 1.2]], 0.19, meteorMaterial(0xaa82ff, 0.48));
  meteorTube('meteor-violet-aura', [[-0.15, 0.02, -0.04], [5.5, 3.4, -0.12], [13.5, 9.5, -0.08], [25, 21, 0.4], [41, 38, 1.55]], 0.4, meteorMaterial(0x7f65e8, 0.11));

  const meteorHead = new THREE.Mesh(new THREE.SphereGeometry(0.48, 18, 12), meteorMaterial(0xfff7df, 1));
  meteorHead.name = 'meteor-white-gold-nucleus';
  const meteorHeadGlow = new THREE.Mesh(new THREE.SphereGeometry(1.05, 18, 12), meteorMaterial(0x8ee9ff, 0.32));
  const meteorHeadBloom = new THREE.Mesh(new THREE.SphereGeometry(1.85, 16, 10), meteorMaterial(0x6fbbff, 0.09));
  meteor.add(meteorHead, meteorHeadGlow, meteorHeadBloom);

  const fragmentPositions = [];
  for (let index = 0; index < 44; index++) {
    const distance = 2.4 + index * 0.88;
    fragmentPositions.push(
      distance,
      distance * 0.48 + Math.sin(index * 2.1) * (0.35 + index * 0.022),
      Math.cos(index * 1.7) * 0.42,
    );
  }
  const fragmentGeometry = new THREE.BufferGeometry();
  fragmentGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fragmentPositions, 3));
  const fragmentMaterial = new THREE.PointsMaterial({
    color: 0xc9ecff,
    size: 0.24,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  fragmentMaterial.userData.baseOpacity = 0.72;
  meteorMaterials.push(fragmentMaterial);
  const meteorFragments = new THREE.Points(fragmentGeometry, fragmentMaterial);
  meteorFragments.name = 'meteor-shed-fragments';
  meteor.add(meteorFragments);
  root.add(meteor);

  const meteorStart = new THREE.Vector3(-8, floorY + 31.5, 56);
  const meteorEnd = new THREE.Vector3(-61, floorY + 16.5, 59);
  const meteorPosition = new THREE.Vector3();
  const updateMeteor = (now) => {
    const seconds = now * 0.001;
    const cycle = (seconds + 2.8) % 25;
    const activeDuration = 16.5;
    if (cycle >= activeDuration) {
      meteor.visible = false;
      return;
    }
    meteor.visible = true;
    const progress = cycle / activeDuration;
    const eased = progress * progress * (3 - 2 * progress);
    meteorPosition.copy(meteorStart).lerp(meteorEnd, eased);
    meteorPosition.y += Math.sin(progress * Math.PI) * 2.8;
    meteorPosition.z += Math.sin(progress * Math.PI * 2) * 0.7;
    meteor.position.copy(meteorPosition);
    meteor.rotation.z = -0.035 + Math.sin(seconds * 0.3) * 0.012;
    const fadeIn = THREE.MathUtils.clamp(progress / 0.075, 0, 1);
    const fadeOut = THREE.MathUtils.clamp((1 - progress) / 0.2, 0, 1);
    const flicker = 0.94 + Math.sin(seconds * 8.4) * 0.035 + Math.sin(seconds * 13.7) * 0.02;
    const visibility = Math.min(fadeIn, fadeOut) * flicker;
    for (const material of meteorMaterials) material.opacity = material.userData.baseOpacity * visibility;
    const pulse = 1 + Math.sin(seconds * 5.2) * 0.035;
    meteor.scale.setScalar(pulse);
    meteor.updateMatrix();
  };
  updateMeteor(performance.now());

  const cityGroundMaterial = floorMaterial.clone();
  cityGroundMaterial.color.setHex(0x151d23);
  cityGroundMaterial.roughness = 0.48;
  cityGroundMaterial.metalness = 0.12;
  // Begin strictly outside the lobby slab; the former one-metre overlap caused
  // the striped Z-fighting visible from oblique views.
  addBox('city-backdrop-ground', [31, 0.1, 24.9], [-36.5, floorY - 0.08, 22.5], cityGroundMaterial);

  // Near-field plaza geometry bridges the glass facade and distant buildings.
  const exteriorStone = new THREE.MeshStandardMaterial({ color: 0x18242a, roughness: 0.88, metalness: 0.04, map: wallSurface, bumpMap: wallSurface, bumpScale: 0.01 });
  const wetStone = new THREE.MeshStandardMaterial({ color: 0x0b171e, roughness: 0.32, metalness: 0.22 });
  const exteriorDark = new THREE.MeshStandardMaterial({ color: 0x0d151c, roughness: 0.72, metalness: 0.24 });
  const exteriorGreen = new THREE.MeshStandardMaterial({ color: 0x193a31, roughness: 0.95 });
  const facadeSlate = new THREE.MeshStandardMaterial({ color: 0x03080b, roughness: 0.76, metalness: 0.14, map: wallSurface, bumpMap: wallSurface, bumpScale: 0.012 });
  const facadeStone = new THREE.MeshStandardMaterial({ color: 0x05090b, roughness: 0.88, metalness: 0.04, map: wallSurface, bumpMap: wallSurface, bumpScale: 0.012 });
  const facadeBlue = new THREE.MeshStandardMaterial({ color: 0x061824, roughness: 0.48, metalness: 0.28, map: wallSurface, bumpMap: wallSurface, bumpScale: 0.008 });
  const curtainGlass = new THREE.MeshPhysicalMaterial({ color: 0x06131c, roughness: 0.16, metalness: 0.48, clearcoat: 0.42, clearcoatRoughness: 0.24, transparent: true, opacity: 0.72 });
  const coolWindow = new THREE.MeshStandardMaterial({ color: 0x163b50, emissive: 0x12384b, emissiveIntensity: 1.15, roughness: 0.2, metalness: 0.38 });
  const warmWindow = new THREE.MeshStandardMaterial({ color: 0xb58a52, emissive: 0x8f5726, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.12 });
  const shopGlow = new THREE.MeshBasicMaterial({ color: 0xe9a866, transparent: true, opacity: 0.5, toneMapped: false });

  addBox('exterior-promenade', [30.5, 0.07, 7.8], [-36.5, floorY - 0.01, 14.2], wetStone);
  addBox('exterior-street', [27, 0.065, 4.8], [-36.5, floorY, 19.8], exteriorDark);
  addBox('exterior-far-sidewalk', [27, 0.09, 3.2], [-36.5, floorY + 0.02, 23.7], wetStone);
  const plazaJoint = new THREE.MeshBasicMaterial({ color: 0x10191f, transparent: true, opacity: 0.46, depthWrite: false });
  for (let z = 10.9; z <= 17.5; z += 1.12) addBox('exterior-paving-joint', [30.2, 0.012, 0.024], [-36.5, floorY + 0.035, z], plazaJoint);
  for (let x = -50.5; x <= -22.5; x += 2.1) addBox('exterior-paving-joint', [0.024, 0.012, 7.35], [x, floorY + 0.036, 14.2], plazaJoint);
  addBox('exterior-near-curb', [27, 0.2, 0.22], [-36.5, floorY + 0.08, 18.04], exteriorStone);
  addBox('exterior-far-curb', [27, 0.2, 0.22], [-36.5, floorY + 0.08, 21.96], exteriorStone);
  for (let x = -47.5; x <= -25.5; x += 4.4) {
    addBox('exterior-crosswalk-stripe', [2.15, 0.025, 0.42], [x, floorY + 0.05, 19.8], ivory);
  }
  const amberReflection = new THREE.MeshBasicMaterial({ color: 0xb9783f, transparent: true, opacity: 0.16, depthWrite: false });
  for (const [x, width] of [[-48.7, 1.7], [-43.8, 1.3], [-36.5, 3.1], [-29.1, 1.4], [-23.8, 1.5]]) {
    addBox('exterior-window-reflection', [width, 0.012, 1.45], [x, floorY + 0.085, 23.25], amberReflection);
  }

  const coolWindowPositions = [];
  const warmWindowPositions = [];
  const coolSideWindowPositions = [];
  const warmSideWindowPositions = [];
  const addExteriorBuilding = (name, x, z, width, height, depth, material, columns, rows) => {
    addBox(name, [width, height, depth], [x, floorY + height / 2, z], material);
    addBox(`${name}-crown`, [width + 0.18, 0.22, depth + 0.16], [x, floorY + height + 0.08, z], exteriorDark);
    addBox(`${name}-curtain-wall`, [width * 0.86, height - 1.75, 0.07], [x, floorY + height / 2 + 0.78, z - depth / 2 - 0.035], curtainGlass);
    addBox(`${name}-lobby`, [width * 0.82, 1.35, 0.16], [x, floorY + 0.76, z - depth / 2 - 0.09], darkGlass);
    addBox(`${name}-lobby-glow`, [width * 0.68, 0.92, 0.055], [x, floorY + 0.78, z - depth / 2 + 0.015], shopGlow);
    addBox(`${name}-entrance-canopy`, [width * 0.58, 0.09, 0.74], [x, floorY + 1.55, z - depth / 2 - 0.36], exteriorDark);
    // The side elevations are visible through the wide corner glazing. They
    // need their own curtain walls and lit windows, otherwise a real building
    // reads like a single flat brown obstruction from oblique viewpoints.
    for (const side of [-1, 1]) {
      const sideX = x + side * (width / 2 + 0.035);
      addBox(`${name}-side-curtain-wall`, [0.07, height - 1.75, depth * 0.72], [sideX, floorY + height / 2 + 0.78, z], curtainGlass);
      addBox(`${name}-side-lobby-glow`, [0.055, 1.05, depth * 0.58], [sideX + side * 0.015, floorY + 0.82, z], shopGlow);
      addBox(`${name}-side-leading-edge`, [0.11, height + 0.12, 0.13], [sideX + side * 0.025, floorY + height / 2, z - depth * 0.36], exteriorDark);
      addBox(`${name}-side-trailing-edge`, [0.11, height + 0.12, 0.13], [sideX + side * 0.025, floorY + height / 2, z + depth * 0.36], exteriorDark);
      const sideColumns = Math.max(2, Math.round(depth / 1.8));
      for (let column = 0; column < sideColumns; column++) {
        for (let row = 0; row < rows; row++) {
          const position = [
            sideX + side * 0.045,
            floorY + 2.05 + row * ((height - 2.85) / Math.max(1, rows - 1)),
            z + (column - (sideColumns - 1) / 2) * (depth * 0.58 / Math.max(1, sideColumns - 1)),
          ];
          ((column * 3 + row + Math.round(z)) % 7 === 0 ? warmSideWindowPositions : coolSideWindowPositions).push(position);
        }
      }
    }
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows; row++) {
        const position = [
          x + (column - (columns - 1) / 2) * (width * 0.72 / Math.max(1, columns - 1)),
          floorY + 2.05 + row * ((height - 2.85) / Math.max(1, rows - 1)),
          z - depth / 2 - 0.075,
        ];
        ((column + row * 2 + Math.round(x)) % 6 === 0 ? warmWindowPositions : coolWindowPositions).push(position);
      }
    }
    for (let column = 1; column < columns; column++) {
      const mullionX = x - width * 0.36 + column * (width * 0.72 / columns);
      addBox(`${name}-mullion`, [0.07, height - 1.65, 0.08], [mullionX, floorY + height / 2 + 0.4, z - depth / 2 - 0.11], exteriorDark);
    }
    for (let row = 1; row < rows; row += 2) {
      const bandY = floorY + 1.72 + row * ((height - 2.7) / Math.max(1, rows));
      addBox(`${name}-floor-band`, [width * 0.9, 0.055, 0.09], [x, bandY, z - depth / 2 - 0.12], exteriorDark);
    }
    addBox(`${name}-roof-screen`, [width * 0.42, 0.72, depth * 0.38], [x + width * 0.12, floorY + height + 0.47, z], exteriorDark);
  };

  // Tall masses frame the view; the deliberately lower center reveals the sky.
  addExteriorBuilding('plaza-building-01', -49.2, 32.2, 5.1, 13.6, 5.2, facadeStone, 3, 7);
  addExteriorBuilding('plaza-building-02', -43.9, 32.8, 4.6, 9.8, 4.6, facadeBlue, 3, 5);
  addExteriorBuilding('plaza-building-04', -29.1, 32.8, 4.8, 10.4, 4.8, facadeStone, 3, 5);
  addExteriorBuilding('plaza-building-05', -23.7, 32.1, 4.9, 14.3, 5.1, facadeBlue, 3, 8);

  const pavilion = new THREE.Group();
  pavilion.name = 'plaza-cultural-pavilion';
  pavilion.position.set(-36.5, floorY, 31.2);
  const pavilionBody = new THREE.Mesh(new RoundedBoxGeometry(8.2, 5.9, 5.1, 5, 0.28), facadeSlate);
  pavilionBody.position.y = 2.95;
  const pavilionGlass = new THREE.Mesh(new THREE.BoxGeometry(7.45, 4.05, 0.13), curtainGlass);
  pavilionGlass.position.set(0, 2.45, -2.61);
  const pavilionWarmInterior = new THREE.Mesh(new THREE.BoxGeometry(6.95, 3.54, 0.06), shopGlow);
  pavilionWarmInterior.position.set(0, 2.42, -2.52);
  pavilion.add(pavilionBody, pavilionWarmInterior, pavilionGlass);
  // Treat both end elevations as designed cinema frontage rather than exposing
  // the undecorated side of the pavilion as a featureless wall.
  for (const side of [-1, 1]) {
    const sideGlow = new THREE.Mesh(new THREE.BoxGeometry(0.055, 3.46, 3.62), shopGlow);
    sideGlow.position.set(side * 4.13, 2.42, 0);
    const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(0.09, 4.06, 4.06), curtainGlass);
    sideGlass.position.set(side * 4.18, 2.45, 0);
    pavilion.add(sideGlow, sideGlass);
    for (const z of [-1.48, -0.74, 0, 0.74, 1.48]) {
      addBox('pavilion-side-mullion', [0.1, 4.12, 0.075], [side * 4.24, 2.45, z], exteriorDark, pavilion);
    }
    addBox('pavilion-side-plinth', [0.16, 0.62, 4.18], [side * 4.22, 0.31, 0], exteriorStone, pavilion);
    addBox('pavilion-side-crown-light', [0.13, 0.08, 3.68], [side * 4.25, 5.44, 0], cyan, pavilion);
  }
  for (const x of [-3.02, -2.02, -1.02, 0, 1.02, 2.02, 3.02]) {
    addBox('pavilion-mullion', [0.075, 4.12, 0.1], [x, 2.45, -2.69], exteriorDark, pavilion);
  }
  addBox('pavilion-canopy', [6.3, 0.16, 1.34], [0, 2.02, -3.18], exteriorDark, pavilion);
  addBox('pavilion-roof-light', [7.15, 0.08, 0.09], [0, 5.45, -2.68], cyan, pavilion);
  const pavilionSign = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 0.72),
    configurableLabelMaterial('plaza', 'VELVET PLAZA', 'CULTURE  /  CINEMA  /  NIGHT'),
  );
  pavilionSign.position.set(0, 4.92, -2.7);
  pavilionSign.rotation.y = Math.PI;
  pavilion.add(pavilionSign);
  root.add(pavilion);

  // A lower cinema annex closes the previously empty right-hand view without
  // turning the plaza into a wall of towers. Its glazed lounge, canopy and
  // vertical marquee bridge the distant skyline into the auditorium facade.
  const rightAnnex = new THREE.Group();
  rightAnnex.name = 'right-plaza-cinema-annex';
  rightAnnex.position.set(-24.15, floorY, 28.15);
  const annexBody = new THREE.Mesh(new RoundedBoxGeometry(7.35, 8.15, 5.05, 5, 0.22), facadeBlue);
  annexBody.position.y = 4.08;
  const annexInterior = new THREE.Mesh(new THREE.BoxGeometry(6.55, 4.15, 0.07), shopGlow);
  annexInterior.position.set(-0.25, 2.65, -2.55);
  const annexGlass = new THREE.Mesh(new THREE.BoxGeometry(6.8, 4.75, 0.12), curtainGlass);
  annexGlass.position.set(-0.25, 2.78, -2.61);
  rightAnnex.add(annexBody, annexInterior, annexGlass);
  for (const x of [-3.15, -2.05, -0.95, 0.15, 1.25, 2.35]) {
    addBox('right-annex-front-mullion', [0.085, 4.86, 0.1], [x, 2.78, -2.68], exteriorDark, rightAnnex);
  }
  addBox('right-annex-stone-base', [7.5, 0.74, 5.18], [0, 0.37, 0], exteriorStone, rightAnnex);
  addBox('right-annex-canopy', [5.4, 0.18, 1.42], [-0.55, 4.42, -3.06], exteriorDark, rightAnnex);
  addBox('right-annex-canopy-light', [4.85, 0.035, 0.12], [-0.55, 4.3, -3.72], whiteGlow, rightAnnex);
  addBox('right-annex-roofline', [7.05, 0.1, 0.1], [-0.12, 7.72, -2.66], cyan, rightAnnex);
  for (const x of [-1.18, 0.25]) {
    addBox('right-annex-entry-door', [1.24, 3.25, 0.09], [x, 2.02, -2.72], darkGlass, rightAnnex);
    addBox('right-annex-entry-handle', [0.045, 0.74, 0.06], [x + 0.34, 2.0, -2.79], silver, rightAnnex);
  }
  const annexSign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.55, 0.88),
    configurableLabelMaterial('lounge', 'VELVET LOUNGE', 'PREMIUM CINEMA ANNEX'),
  );
  annexSign.position.set(-0.3, 6.72, -2.7);
  rightAnnex.add(annexSign);
  const annexTower = new THREE.Mesh(new RoundedBoxGeometry(1.18, 13.6, 1.55, 4, 0.14), exteriorDark);
  annexTower.position.set(3.02, 6.8, 0.35);
  const annexTowerLight = new THREE.Mesh(new THREE.BoxGeometry(0.07, 11.6, 0.15), cyan);
  annexTowerLight.position.set(3.64, 6.8, -0.28);
  rightAnnex.add(annexTower, annexTowerLight);
  for (const y of [2.1, 4.25, 6.4, 8.55, 10.7]) {
    addBox('right-annex-tower-reveal', [0.1, 0.72, 1.14], [3.64, y, 0.35], y === 6.4 ? warmWindow : coolWindow, rightAnnex);
  }
  root.add(rightAnnex);

  // From the lobby's oblique right-looking viewpoint, screen-right maps to
  // the plaza's west edge. This closer gallery wing fills that empty skyline
  // while staying behind the far sidewalk and leaving the road unobstructed.
  const westGallery = new THREE.Group();
  westGallery.name = 'west-corner-night-gallery';
  westGallery.position.set(-48.05, floorY, 27.35);
  const galleryBody = new THREE.Mesh(new RoundedBoxGeometry(6.55, 10.7, 3.7, 5, 0.2), facadeStone);
  galleryBody.position.y = 5.35;
  const galleryWarmInterior = new THREE.Mesh(new THREE.BoxGeometry(5.85, 4.4, 0.06), shopGlow);
  galleryWarmInterior.position.set(0, 2.62, -1.87);
  const galleryGlass = new THREE.Mesh(new THREE.BoxGeometry(6.05, 8.1, 0.11), curtainGlass);
  galleryGlass.position.set(0, 4.75, -1.93);
  westGallery.add(galleryBody, galleryWarmInterior, galleryGlass);
  for (const x of [-2.55, -1.7, -0.85, 0, 0.85, 1.7, 2.55]) {
    addBox('west-gallery-front-mullion', [0.075, 8.18, 0.1], [x, 4.75, -2.0], exteriorDark, westGallery);
  }
  for (const y of [4.3, 6.55, 8.8]) {
    addBox('west-gallery-floor-band', [6.12, 0.075, 0.11], [0, y, -2.02], exteriorDark, westGallery);
  }
  addBox('west-gallery-stone-base', [6.72, 0.82, 3.84], [0, 0.41, 0], exteriorStone, westGallery);
  addBox('west-gallery-entry-canopy', [4.25, 0.16, 1.2], [0.62, 3.72, -2.42], exteriorDark, westGallery);
  addBox('west-gallery-entry-light', [3.72, 0.035, 0.11], [0.62, 3.61, -2.98], whiteGlow, westGallery);
  for (const x of [0.02, 1.22]) {
    addBox('west-gallery-entry-door', [1.02, 2.8, 0.08], [x, 1.82, -2.02], darkGlass, westGallery);
  }
  const gallerySign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.65, 0.82),
    configurableLabelMaterial('gallery', 'NIGHT GALLERY', 'VELVET PLAZA  /  OPEN LATE'),
  );
  gallerySign.position.set(0, 9.65, -2.04);
  westGallery.add(gallerySign);
  addBox('west-gallery-roofline-light', [6.12, 0.09, 0.11], [0, 10.26, -1.98], cyan, westGallery);
  addBox('west-gallery-roof-terrace', [5.6, 0.34, 2.7], [0, 10.82, 0.08], exteriorStone, westGallery);
  for (const x of [-2.05, -1.02, 0, 1.02, 2.05]) {
    addBox('west-gallery-roof-pergola-post', [0.09, 1.45, 0.09], [x, 11.55, 0.2], exteriorDark, westGallery);
  }
  addBox('west-gallery-roof-pergola', [5.2, 0.11, 2.15], [0, 12.26, 0.2], exteriorDark, westGallery);
  for (const x of [-1.75, -0.85, 0.05, 0.95, 1.85]) {
    const roofShrub = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 7), exteriorGreen);
    roofShrub.position.set(x, 11.12, -0.42 + Math.sin(x * 2.2) * 0.18);
    roofShrub.scale.set(1.15, 0.72, 0.8);
    westGallery.add(roofShrub);
  }
  root.add(westGallery);

  // A freestanding premiere marquee occupies the extreme screen-right gap in
  // this oblique view. It sits on the far pavement buffer, not in the roadway.
  const marqueeCopy = {
    brand: 'VELVET',
    number: '07',
    premiere: 'PREMIERE TONIGHT',
    format: 'IMAX LASER',
    auditorium: 'AUDITORIUM 01',
    time: '19:30',
    gallery: 'NIGHT GALLERY',
    location: 'CITY PLAZA  /  LEVEL 01',
    mark: 'V',
  };
  const marqueePanel = canvasTexture(512, 1536, (ctx, canvas) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#07121c');
    gradient.addColorStop(0.55, '#10283a');
    gradient.addColorStop(1, '#060d14');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#60d9f5';
    ctx.fillRect(0, 0, 18, canvas.height);
    ctx.fillRect(canvas.width - 18, 0, 18, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eef7f8';
    ctx.font = '800 72px Arial, sans-serif';
    ctx.fillText(marqueeCopy.brand, canvas.width / 2, 180);
    ctx.fillStyle = '#67dcf5';
    ctx.font = '900 172px Arial, sans-serif';
    ctx.fillText(marqueeCopy.number, canvas.width / 2, 390);
    ctx.fillStyle = '#dce8ec';
    ctx.font = '700 33px Arial, sans-serif';
    ctx.fillText(marqueeCopy.premiere, canvas.width / 2, 510);
    ctx.strokeStyle = '#37677d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(76, 570);
    ctx.lineTo(canvas.width - 76, 570);
    ctx.stroke();
    ctx.fillStyle = '#8babb8';
    ctx.font = '600 28px Arial, sans-serif';
    ctx.fillText(marqueeCopy.format, canvas.width / 2, 670);
    ctx.fillText(marqueeCopy.auditorium, canvas.width / 2, 730);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 82px Arial, sans-serif';
    ctx.fillText(marqueeCopy.time, canvas.width / 2, 875);
    ctx.fillStyle = '#6edaf2';
    ctx.font = '700 31px Arial, sans-serif';
    ctx.fillText(marqueeCopy.gallery, canvas.width / 2, 1040);
    ctx.fillStyle = '#98aeb7';
    ctx.font = '500 25px Arial, sans-serif';
    ctx.fillText(marqueeCopy.location, canvas.width / 2, 1100);
    ctx.fillStyle = '#e7c58e';
    ctx.beginPath();
    ctx.arc(canvas.width / 2, 1275, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#07121c';
    ctx.font = '900 42px Arial, sans-serif';
    ctx.fillText(marqueeCopy.mark, canvas.width / 2, 1290);
  });
  const marqueeTexture = marqueePanel.texture;
  const plazaMarquee = new THREE.Group();
  plazaMarquee.name = 'plaza-premiere-marquee';
  plazaMarquee.position.set(-50.15, floorY, 23.9);
  const marqueeBody = new THREE.Mesh(new RoundedBoxGeometry(2.18, 10.9, 0.74, 4, 0.12), exteriorDark);
  marqueeBody.position.y = 5.56;
  const marqueeScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.78, 9.65),
    new THREE.MeshBasicMaterial({ map: marqueeTexture, toneMapped: false }),
  );
  marqueeScreen.position.set(0, 5.58, -0.39);
  marqueeScreen.rotation.y = Math.PI;
  plazaMarquee.add(marqueeBody, marqueeScreen);
  addBox('plaza-marquee-left-light', [0.075, 10.1, 0.08], [-1.02, 5.58, -0.43], cyan, plazaMarquee);
  addBox('plaza-marquee-right-light', [0.075, 10.1, 0.08], [1.02, 5.58, -0.43], cyan, plazaMarquee);
  addBox('plaza-marquee-cap', [2.46, 0.26, 1.0], [0, 11.0, 0], exteriorStone, plazaMarquee);
  addBox('plaza-marquee-base', [2.72, 0.42, 1.48], [0, 0.21, 0], exteriorStone, plazaMarquee);
  root.add(plazaMarquee);

  const addWindowInstances = (name, positions, material) => {
    const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.68, 0.5, 0.055), material, positions.length);
    windows.name = name;
    const transform = new THREE.Object3D();
    positions.forEach((position, index) => {
      transform.position.set(...position);
      transform.updateMatrix();
      windows.setMatrixAt(index, transform.matrix);
    });
    windows.instanceMatrix.needsUpdate = true;
    root.add(windows);
  };
  addWindowInstances('plaza-cool-windows', coolWindowPositions, coolWindow);
  addWindowInstances('plaza-warm-windows', warmWindowPositions, warmWindow);
  const addSideWindowInstances = (name, positions, material) => {
    const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.055, 0.5, 0.68), material, positions.length);
    windows.name = name;
    const transform = new THREE.Object3D();
    positions.forEach((position, index) => {
      transform.position.set(...position);
      transform.updateMatrix();
      windows.setMatrixAt(index, transform.matrix);
    });
    windows.instanceMatrix.needsUpdate = true;
    root.add(windows);
  };
  addSideWindowInstances('plaza-cool-side-windows', coolSideWindowPositions, coolWindow);
  addSideWindowInstances('plaza-warm-side-windows', warmSideWindowPositions, warmWindow);

  addBox('entry-canopy', [18, 0.32, 3.6], [-36.5, floorY + 8.75, 11.7], exteriorDark);
  addBox('entry-canopy-light', [14.8, 0.04, 0.22], [-36.5, floorY + 8.54, 11.25], whiteGlow);
  for (const x of [-45, -28]) addBox('entry-canopy-post', [0.28, 8.5, 0.28], [x, floorY + 4.2, 12.8], exteriorDark);
  for (const x of [-42.5, -38.5, -34.5, -30.5]) {
    const downlight = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.025, 16), whiteGlow);
    downlight.position.set(x, floorY + 8.56, 12.3);
    root.add(downlight);
  }
  for (const [x, z, width] of [[-47.5, 14.2, 6], [-25.5, 14.6, 5]]) {
    addBox('exterior-planter', [width, 0.72, 1.55], [x, floorY + 0.34, z], exteriorStone);
    addBox('exterior-planter-soil', [width - 0.35, 0.08, 1.2], [x, floorY + 0.73, z], graphite);
    for (let offset = -width / 2 + 0.6; offset < width / 2; offset += 0.85) {
      const shrub = new THREE.Mesh(new THREE.SphereGeometry(0.39, 10, 7), exteriorGreen);
      shrub.position.set(x + offset, floorY + 1.08, z);
      shrub.scale.set(1, 0.8, 0.72);
      root.add(shrub);
    }
  }
  // The glass facade now terminates in intentional landscape returns instead
  // of exposing the edge of the exterior slab or letting the interior wall cut the road.
  addBox('left-facade-end-cap', [0.48, 8.9, 0.55], [-51.68, floorY + 4.42, 9.92], exteriorDark);
  addBox('right-courtyard-retaining-wall', [0.52, 0.76, 8.4], [-21.42, floorY + 0.37, 14.25], exteriorStone);
  for (let z = 10.7; z <= 17.8; z += 0.72) {
    addBox('right-courtyard-louver', [0.13, 3.6, 0.14], [-21.44, floorY + 2.25, z], exteriorDark);
  }
  for (let z = 11.2; z <= 17.4; z += 1.02) {
    const vine = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 7), exteriorGreen);
    vine.position.set(-21.66, floorY + 1.08 + Math.sin(z) * 0.18, z);
    vine.scale.set(0.65, 1.15, 0.9);
    root.add(vine);
  }
  // The auditorium genuinely occupies the plaza's right edge. Wrap its tall
  // structural wall in a complete exterior elevation so it reads as the end
  // of the cinema complex—not as a stray brown plane crossing the street.
  addBox('auditorium-exterior-shell', [0.42, 19.7, 18.45], [-20.47, floorY + 9.72, 18.55], facadeSlate);
  addBox('auditorium-exterior-stone-base', [0.54, 1.18, 18.65], [-20.7, floorY + 0.58, 18.55], exteriorStone);
  for (let z = 10.35; z <= 26.75; z += 2.34) {
    addBox('auditorium-exterior-glass-bay', [0.11, 6.15, 1.88], [-20.72, floorY + 4.25, z], darkGlass);
    addBox('auditorium-exterior-upper-panel', [0.13, 8.15, 1.88], [-20.7, floorY + 12.05, z], graphite);
    addBox('auditorium-exterior-vertical-fin', [0.42, 18.4, 0.11], [-20.87, floorY + 9.65, z - 1.05], exteriorDark);
  }
  addBox('auditorium-exterior-crown', [0.58, 0.34, 18.8], [-20.75, floorY + 19.08, 18.55], exteriorDark);
  addBox('auditorium-exterior-crown-light', [0.08, 0.1, 17.4], [-21.05, floorY + 18.72, 18.55], cyan);
  const exteriorHallSign = new THREE.Mesh(
    new THREE.PlaneGeometry(6.1, 1.05),
    configurableLabelMaterial('exteriorHall', 'AUDITORIUM 01', 'IMAX LASER  /  VELVET 07'),
  );
  exteriorHallSign.position.set(-21.09, floorY + 8.45, 18.55);
  exteriorHallSign.rotation.y = -Math.PI / 2;
  root.add(exteriorHallSign);
  for (const x of [-46.7, -26.1]) {
    addBox('exterior-tree-trunk', [0.18, 2.5, 0.18], [x, floorY + 1.8, 16.15], materials.wood);
    for (const [dx, dy, dz, scale] of [[0, 3.25, 0, 0.74], [-0.42, 3.02, 0.1, 0.54], [0.4, 2.98, -0.08, 0.58]]) {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.82, 14, 10), exteriorGreen);
      crown.position.set(x + dx, floorY + dy, 16.15 + dz);
      crown.scale.set(scale, scale * 1.12, scale);
      root.add(crown);
    }
  }
  addBox('exterior-bench-seat', [4.25, 0.24, 1.0], [-43.2, floorY + 0.52, 15.65], materials.wood);
  addBox('exterior-bench-back', [4.25, 0.78, 0.16], [-43.2, floorY + 0.94, 16.08], materials.wood);
  addBox('exterior-bench-base-left', [0.28, 0.48, 0.72], [-44.65, floorY + 0.24, 15.65], exteriorDark);
  addBox('exterior-bench-base-right', [0.28, 0.48, 0.72], [-41.75, floorY + 0.24, 15.65], exteriorDark);

  // An illuminated ring gives the plaza one memorable object instead of more furniture.
  const plazaRingMaterial = new THREE.MeshStandardMaterial({ color: 0x8bdcf3, emissive: 0x168db5, emissiveIntensity: 1.65, roughness: 0.28, metalness: 0.42 });
  const plazaRing = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.065, 12, 48), plazaRingMaterial);
  plazaRing.name = 'plaza-light-sculpture';
  plazaRing.position.set(-36.25, floorY + 2.0, 15.9);
  root.add(plazaRing);
  addBox('plaza-sculpture-plinth', [1.85, 0.28, 0.86], [-36.25, floorY + 0.15, 15.9], exteriorStone);
  addBox('plaza-sculpture-stem', [0.12, 0.88, 0.12], [-36.25, floorY + 0.67, 15.9], silver);

  for (const x of [-49.1, -23.9]) {
    addBox('exterior-lamp-post', [0.11, 3.3, 0.11], [x, floorY + 1.65, 17.25], exteriorDark);
    addBox('exterior-lamp-arm', [0.82, 0.08, 0.08], [x + (x < -36 ? 0.34 : -0.34), floorY + 3.25, 17.25], exteriorDark);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd9ad, toneMapped: false }));
    head.position.set(x + (x < -36 ? 0.7 : -0.7), floorY + 3.23, 17.25);
    root.add(head);
    const pool = new THREE.PointLight(0xffbd7e, 0.34, 7, 2);
    pool.position.copy(head.position);
    root.add(pool);
  }
  for (const x of [-49, -42.7, -30.3, -24]) {
    addBox('exterior-bollard', [0.16, 0.72, 0.16], [x, floorY + 0.36, 12.15], exteriorDark);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd4a1 }));
    lamp.position.set(x, floorY + 0.75, 12.15);
    root.add(lamp);
  }

  // Transparent entrance and the user's right-hand corner form one glass facade.
  addBox('entry-glass', [30.2, 8.7, 0.14], [-36.5, floorY + 4.45, 9.82], glass);
  for (const x of [-51.2, -45.3, -40.3, -36.5, -32.7, -27.7, -21.8]) {
    addBox('entry-mullion', [0.12, 9.2, 0.18], [x, floorY + 4.6, 9.72], silver);
  }
  addBox('entry-door-left', [3.55, 6.75, 0.18], [-38.35, floorY + 3.42, 9.61], glass);
  addBox('entry-door-right', [3.55, 6.75, 0.18], [-34.65, floorY + 3.42, 9.61], glass);
  addBox('right-glass', [0.14, 8.7, 4.25], [-21.02, floorY + 4.45, 7.65], glass);
  for (const z of [5.55, 7.65, 9.6]) addBox('right-glass-mullion', [0.18, 9.1, 0.12], [-21.1, floorY + 4.55, z], silver);
  addCollider(-21.02, 7.65, 0.14, 2.15);

  // Straight recessed light ribbons keep the ceiling quiet and the central aisle clear.
  for (const [x, width] of [[-47.2, 6.4], [-38.1, 8.8], [-27.6, 7]]) {
    addBox('ceiling-light-ribbon', [width, 0.055, 0.28], [x, floorY + 9.47, 1.4], whiteGlow);
    addBox('ceiling-cyan-guide', [width * 0.62, 0.045, 0.08], [x, floorY + 9.43, -5.8], cyan);
  }

  // A proper staffed counter: 3.3 m of working room separates the service top
  // from the menu wall, and a right return closes the gap beside the corridor.
  addBox('counter-staff-floor', [22.2, 0.08, 4.2], [-40.35, floorY + 0.02, -18.75], materials.wood);
  addBox('counter-feature-wall', [21.9, 9.1, 0.36], [-40.55, floorY + 4.65, -21.05], charcoal);
  addBox('counter-blue-reveal', [22.1, 0.16, 0.15], [-40.55, floorY + 8.92, -20.82], cyan);
  addBox('counter-base', [21.6, 1.12, 2.1], [-40.25, floorY + 0.56, -15.8], materials.wood);
  addBox('counter-front-panel', [20.8, 0.68, 0.12], [-40.25, floorY + 0.6, -14.71], graphite);
  for (let x = -50.2; x <= -30.1; x += 0.72) addBox('counter-front-rib', [0.08, 0.72, 0.08], [x, floorY + 0.6, -14.61], silver);
  addBox('counter-front-light', [20.9, 0.1, 0.08], [-40.25, floorY + 0.2, -14.62], cyan);
  addBox('counter-top', [22, 0.15, 2.35], [-40.25, floorY + 1.16, -15.76], silver);
  addBox('counter-right-return', [0.38, 3.15, 6.25], [-29.28, floorY + 1.55, -18.0], materials.wood);
  addBox('counter-right-return-trim', [0.1, 3.25, 6.35], [-29.06, floorY + 1.6, -18.0], silver);
  addCollider(-40.25, -16.4, 11.15, 1.95);
  addCollider(-29.28, -18.0, 0.3, 3.2);

  const concessionSign = new THREE.Mesh(
    new THREE.PlaneGeometry(9.7, 1.2),
    configurableLabelMaterial('concessions', 'CONCESSIONS', 'FRESH POPCORN  /  DRINKS'),
  );
  concessionSign.position.set(-44.8, floorY + 8.92, -20.8);
  root.add(concessionSign);
  const ticketSign = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 1.2),
    configurableLabelMaterial('boxOffice', 'BOX OFFICE', 'AUDITORIUM 01'),
  );
  ticketSign.position.set(-34.25, floorY + 8.92, -20.8);
  root.add(ticketSign);

  // Custom trailer displays now sit exactly where real cinema menu boards belong: above the counter.
  for (let index = 0; index < 4; index++) {
    const placeholder = trailerPlaceholder(index);
    trailerCanvases.push(placeholder);
    const x = -48.05 + index * 4.83;
    addBox('trailer-frame', [4.5, 2.75, 0.18], [x, floorY + 7.05, -20.79], silver);
    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(4.24, 2.4),
      new THREE.MeshBasicMaterial({ map: placeholder.texture, toneMapped: false }),
    );
    display.position.set(x, floorY + 7.05, -20.68);
    root.add(display);
    trailerSlots.push(display);
  }

  // Counter silhouettes: popcorn warmer, drink towers and two complete POS stations.
  addBox('popcorn-base', [2.2, 0.35, 1.1], [-47.5, floorY + 1.43, -15.65], silver);
  addBox('popcorn-glass', [2.05, 1.95, 1.02], [-47.5, floorY + 2.55, -15.65], glass);
  addBox('popcorn-canopy', [2.3, 0.18, 1.18], [-47.5, floorY + 3.58, -15.65], cyan);
  for (const x of [-44.2, -42.7, -41.2]) addBox('drink-tower', [0.64, 1.08, 0.64], [x, floorY + 1.72, -15.74], charcoal);
  for (const [index, x] of [-36.2, -33.15].entries()) {
    addBox('pos-cash-drawer', [1.65, 0.25, 0.72], [x, floorY + 1.34, -15.88], charcoal);
    addBox('pos-monitor-frame', [1.2, 0.78, 0.15], [x, floorY + 1.91, -15.78], silver);
    const monitor = new THREE.Mesh(
      new THREE.PlaneGeometry(1.05, 0.62),
      new THREE.MeshBasicMaterial({ map: trailerPlaceholder(index + 2).texture, toneMapped: false }),
    );
    monitor.position.set(x, floorY + 1.92, -15.87);
    monitor.rotation.y = Math.PI;
    root.add(monitor);
    addBox('pos-stand', [0.1, 0.38, 0.1], [x, floorY + 1.36, -15.8], silver);
    addBox('pos-keyboard', [1.05, 0.06, 0.38], [x, floorY + 1.27, -16.38], charcoal).rotation.x = 0.08;
  }
  for (const x of [-40.1, -39.55, -39]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.46, 14), paleFabric);
    cup.position.set(x, floorY + 1.48, -15.04);
    root.add(cup);
  }
  for (const x of [-46.5, -45.85]) {
    const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.2, 0.48, 16), new THREE.MeshStandardMaterial({ color: 0xd7a657, roughness: 0.82 }));
    tub.position.set(x, floorY + 1.5, -15.03);
    root.add(tub);
  }
  // Recognizable back-bar cabinetry replaces the former row of ambiguous dark cubbies.
  addBox('counter-back-cabinet', [19.8, 1.15, 0.72], [-40.7, floorY + 1.05, -20.42], materials.wood);
  addBox('counter-back-worktop', [20.1, 0.12, 0.92], [-40.7, floorY + 1.68, -20.31], silver);
  addBox('counter-back-splash', [19.6, 2.35, 0.12], [-40.7, floorY + 2.9, -20.68], materials.wood);
  for (const y of [2.15, 3.18]) {
    addBox('counter-open-shelf', [19.35, 0.09, 0.58], [-40.7, floorY + y, -20.45], silver);
    addBox('counter-shelf-light', [18.9, 0.035, 0.08], [-40.7, floorY + y - 0.09, -20.1], whiteGlow);
  }
  for (const x of [-48.8, -44.75, -40.7, -36.65, -32.6]) {
    addBox('counter-shelf-upright', [0.08, 2.02, 0.52], [x, floorY + 2.66, -20.47], silver);
  }
  const bottlePalette = [0xd4b06a, 0xbfd8dc, 0x9fc2a7, 0xd99a83];
  for (const [row, y] of [2.45, 3.47].entries()) {
    for (let index = 0; index < 13; index++) {
      const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.12, 0.43, 10),
        new THREE.MeshStandardMaterial({ color: bottlePalette[(index + row) % bottlePalette.length], roughness: 0.5 }),
      );
      bottle.position.set(-48.5 + index * 1.3, floorY + y, -20.08);
      root.add(bottle);
    }
  }

  // A physical scale model turns the open counter forecourt into a focal exhibit.
  const modelDisplay = new THREE.Group();
  modelDisplay.name = 'auditorium-miniature-display';
  modelDisplay.position.set(-40.2, floorY, -8.9);
  const modelBase = new THREE.Mesh(new RoundedBoxGeometry(5.35, 0.72, 3.35, 4, 0.12), charcoal);
  modelBase.position.y = 0.36;
  const modelTrim = new THREE.Mesh(new RoundedBoxGeometry(5.05, 0.12, 3.05, 3, 0.05), silver);
  modelTrim.position.y = 0.78;
  const modelDeck = new THREE.Mesh(new THREE.BoxGeometry(4.55, 0.12, 2.48), materials.carpet);
  modelDeck.position.y = 0.9;
  const modelPlaque = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 0.5),
    configurableLabelMaterial('scaleModel', 'AUDITORIUM 01', 'SCALE MODEL'),
  );
  modelPlaque.position.set(0, 0.43, 1.69);
  modelDisplay.add(modelBase, modelTrim, modelDeck, modelPlaque);

  const miniatureScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(3.75, 1.18),
    new THREE.MeshBasicMaterial({ color: 0xcfe9ee, toneMapped: false }),
  );
  miniatureScreen.position.set(0, 1.63, -1.13);
  modelDisplay.add(miniatureScreen);
  for (const side of [-1, 1]) {
    const miniatureWall = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 2.34), graphite);
    miniatureWall.position.set(side * 2.18, 1.49, 0);
    modelDisplay.add(miniatureWall);
  }
  for (let row = 0; row < 5; row++) {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.08 + row * 0.055, 0.38), materials.wood);
    tier.position.set(0, 0.97 + row * 0.05, -0.62 + row * 0.4);
    modelDisplay.add(tier);
  }
  const miniatureSeatGeometry = new RoundedBoxGeometry(0.3, 0.26, 0.25, 2, 0.045);
  const miniatureSeats = new THREE.InstancedMesh(miniatureSeatGeometry, blueFabric, 40);
  miniatureSeats.name = 'miniature-auditorium-seats';
  const miniatureTransform = new THREE.Object3D();
  let miniatureSeatIndex = 0;
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 8; column++) {
      miniatureTransform.position.set(-1.55 + column * 0.445, 1.13 + row * 0.055, -0.63 + row * 0.4);
      miniatureTransform.updateMatrix();
      miniatureSeats.setMatrixAt(miniatureSeatIndex++, miniatureTransform.matrix);
    }
  }
  miniatureSeats.instanceMatrix.needsUpdate = true;
  modelDisplay.add(miniatureSeats);
  const caseMaterial = new THREE.MeshPhysicalMaterial({ color: 0xbad9df, roughness: 0.08, metalness: 0.04, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
  const modelCase = new THREE.Mesh(new THREE.BoxGeometry(5.05, 2.35, 3.02), caseMaterial);
  modelCase.position.y = 1.93;
  modelDisplay.add(modelCase);
  root.add(modelDisplay);
  addCollider(-40.2, -8.9, 2.8, 1.82);

  // All lounge chairs use real-world proportions and expose future sit targets.
  const addInteractiveChair = (label, x, z, rotation, pale = false) => {
    const chair = new THREE.Group();
    chair.position.set(x, floorY, z);
    chair.rotation.y = rotation;
    const base = new THREE.Mesh(new RoundedBoxGeometry(1.34, 0.28, 1.18, 4, 0.1), charcoal);
    base.position.set(0, 0.24, 0);
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(1.28, 0.24, 1.12, 4, 0.11), pale ? paleFabric : blueFabric);
    cushion.position.set(0, 0.49, -0.04);
    const back = new THREE.Mesh(new RoundedBoxGeometry(1.3, 1.12, 0.25, 4, 0.11), pale ? paleFabric : blueFabric);
    back.position.set(0, 1.03, 0.49);
    back.rotation.x = -0.08;
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.28, 1.04, 3, 0.06), charcoal);
      arm.position.set(side * 0.71, 0.68, -0.02);
      chair.add(arm);
    }
    const seat = { kind: 'lobby', label, x, y: floorY, z, yaw: rotation, eyeHeight: 1.28 };
    cushion.userData.lobbySeat = seat;
    back.userData.lobbySeat = seat;
    chair.add(base, cushion, back);
    root.add(chair);
    seatMeshes.push(cushion, back);
    addCollider(x, z, 0.88, 0.86);
    return chair;
  };

  // Seating zone by the right-hand glass, grouped like the user's sketch.
  addInteractiveChair('Lounge 01', -27.5, 7.75, 0, true);
  addInteractiveChair('Lounge 02', -30.8, 4.65, -Math.PI / 2, false);
  addInteractiveChair('Lounge 03', -24.15, 4.55, Math.PI / 2, true);
  addInteractiveChair('Lounge 04', -27.4, 1.3, Math.PI, false);
  const loungeTable = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.84, 0.5, 32), silver);
  loungeTable.position.set(-27.45, floorY + 0.25, 4.55);
  root.add(loungeTable);
  addCollider(-27.45, 4.55, 0.88, 0.88);
  const plantPot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.5, 24), graphite);
  plantPot.position.set(-23.2, floorY + 0.25, 7.35);
  root.add(plantPot);
  for (let index = 0; index < 7; index++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.05, 7), new THREE.MeshStandardMaterial({ color: 0x365648, roughness: 0.9 }));
    leaf.position.set(-23.2 + (index - 3) * 0.07, floorY + 1, 7.35 + Math.sin(index) * 0.12);
    leaf.rotation.z = (index - 3) * 0.1;
    root.add(leaf);
  }

  // One self-service ticket kiosk beside the entrance, already tagged for later interaction.
  const kiosk = new THREE.Group();
  kiosk.position.set(-49.55, floorY, 6.9);
  kiosk.rotation.y = Math.PI / 2;
  const kioskBody = new THREE.Mesh(new RoundedBoxGeometry(2.0, 4.25, 1.08, 4, 0.14), ivory);
  kioskBody.position.y = 2.15;
  kioskBody.userData.lobbyInteraction = 'ticket-kiosk';
  const kioskScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 2.12), kioskScreenMaterial);
  kioskScreen.position.set(0, 2.66, 0.56);
  kioskScreen.userData.lobbyInteraction = 'ticket-kiosk';
  const kioskReader = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.16, 0.11, 2, 0.035), darkGlass);
  kioskReader.position.set(0.46, 1.28, 0.59);
  const kioskReaderLight = new THREE.Mesh(new RoundedBoxGeometry(0.29, 0.035, 0.025, 2, 0.01), cyan);
  kioskReaderLight.position.set(0.46, 1.3, 0.652);
  const kioskTicketSlotBezel = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.15, 0.09, 2, 0.03), silver);
  kioskTicketSlotBezel.position.set(-0.43, 1.24, 0.61);
  const kioskTicketSlot = new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.055, 0.025, 2, 0.015), blackScreen);
  kioskTicketSlot.position.set(-0.43, 1.24, 0.672);
  kiosk.add(kioskBody, kioskScreen, kioskReader, kioskReaderLight, kioskTicketSlotBezel, kioskTicketSlot);
  root.add(kiosk);
  addCollider(-49.55, 6.9, 0.9, 1.3);

  // A genuinely large trailer television fills the rear half of the left wall.
  const wallTrailerPlaceholder = trailerPlaceholder(0);
  trailerCanvases.push(wallTrailerPlaceholder);
  addBox('wall-trailer-tv-frame', [0.22, 3.72, 6.5], [-51.68, floorY + 4.25, -7.2], charcoal);
  const wallTrailerScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(6.18, 3.46),
    new THREE.MeshBasicMaterial({ map: wallTrailerPlaceholder.texture, toneMapped: false }),
  );
  wallTrailerScreen.position.set(-51.54, floorY + 4.25, -7.2);
  wallTrailerScreen.rotation.y = Math.PI / 2;
  root.add(wallTrailerScreen);
  trailerSlots.push(wallTrailerScreen);
  addBox('wall-trailer-soundbar', [0.18, 0.18, 3.5], [-51.47, floorY + 2.12, -7.2], charcoal);

  // One wall speaker can play optional lobby music independently of film audio.
  addBox('lobby-speaker-cabinet', [0.5, 1.35, 1.02], [-51.56, floorY + 7.25, -2.9], charcoal);
  for (const [y, radius] of [[7.55, 0.25], [6.98, 0.18]]) {
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.58, radius, 0.06, 18), blackScreen);
    cone.position.set(-51.26, floorY + y, -2.9);
    cone.rotation.z = Math.PI / 2;
    root.add(cone);
  }

  // Dedicated game display remains separate from the trailer television.
  addBox('game-tv-frame', [0.22, 2.45, 4.25], [-51.68, floorY + 2.45, 0.5], charcoal);
  const gameScreen = new THREE.Mesh(new THREE.PlaneGeometry(3.95, 2.18), gameScreenMaterial);
  gameScreen.position.set(-51.54, floorY + 2.45, 0.5);
  gameScreen.rotation.y = Math.PI / 2;
  gameScreen.userData.lobbyInteraction = 'game-station';
  root.add(gameScreen);
  addBox('game-soundbar', [0.18, 0.16, 2.4], [-51.5, floorY + 1.02, 0.5], charcoal);
  addBox('game-console', [0.5, 0.15, 0.95], [-51.35, floorY + 0.68, 0.5], ivory);
  for (const z of [0.23, 0.77]) {
    const controller = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.1, 0.42, 3, 0.05), graphite);
    controller.position.set(-51.05, floorY + 0.84, z);
    root.add(controller);
  }
  addInteractiveChair('Game Seat', -48.6, 0.5, Math.PI / 2, false);

  // One central standee supplies the visual marker shown in the sketch without blocking circulation.
  const standee = new THREE.Group();
  standee.position.set(-37.1, floorY, 1.4);
  standee.rotation.y = -0.24;
  const standeeBase = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.24, 0.9, 3, 0.07), charcoal);
  standeeBase.position.y = 0.14;
  const standeeFront = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 2.48), new THREE.MeshBasicMaterial({ color: 0x222733, toneMapped: false }));
  standeeFront.position.set(0, 1.48, 0.015);
  const standeeBack = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 2.48), new THREE.MeshBasicMaterial({ color: 0x222733, toneMapped: false }));
  standeeBack.position.set(0, 1.48, -0.015);
  standeeBack.rotation.y = Math.PI;
  standee.add(standeeBase, standeeFront, standeeBack);
  root.add(standee);
  standeeSlots.push([standeeFront, standeeBack]);
  addCollider(-37.1, 1.4, 1.08, 0.72);

  // Ticket check controls the two lanes into the sound lock.
  for (const [index, x] of [-28.15, -25, -21.85].entries()) {
    const pedestal = addBox('ticket-gate-pedestal', [0.62, 1.2, 1.72], [x, floorY + 0.6, -7.75], silver);
    pedestal.userData.lobbyInteraction = 'ticket-gate';
    addBox('ticket-gate-reader', [0.48, 0.1, 0.52], [x, floorY + 1.23, -7.47], index === 1 ? cyan : darkGlass);
    addCollider(x, -7.75, 0.34, 0.9);
  }
  for (const x of [-26.57, -23.42]) {
    const flap = addBox('ticket-gate-open-flap', [1.35, 0.72, 0.06], [x, floorY + 0.84, -7.42], glass);
    flap.rotation.y = x < -25 ? 0.42 : -0.42;
  }
  const gateSign = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 1.05),
    configurableLabelMaterial('ticketCheck', 'TICKET CHECK', 'AUDITORIUM 01  /  OPEN LANES'),
  );
  gateSign.position.set(-24.95, floorY + 5.08, -8.02);
  root.add(gateSign);

  // Poster-lined sound lock runs beside the auditorium and turns right through the screen-left door.
  addBox('soundlock-floor', [8.4, 0.08, 18.2], [-24.9, floorY + 0.01, -16.9], materials.carpet);
  addBox('soundlock-ceiling', [8.4, 0.18, 18.2], [-24.9, floorY + 5.7, -16.9], charcoal);
  addBox('soundlock-divider', [0.3, 5.9, 18.2], [-29.05, floorY + 2.85, -16.9], graphite);
  addCollider(-29.05, -16.9, 0.28, 9.1);
  addBox('soundlock-end-wall', [8.4, 5.9, 0.3], [-24.9, floorY + 2.85, -25.85], graphite);
  addCollider(-24.9, -25.85, 4.2, 0.28);
  for (const [side, x, rotation] of [[-1, -28.83, Math.PI / 2], [1, -20.83, -Math.PI / 2]]) {
    for (const [index, z] of [-11.5, -16.1].entries()) {
      addBox('poster-frame', [0.2, 3.95, 2.55], [x, floorY + 2.75, z], silver);
      const poster = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 3.65), new THREE.MeshBasicMaterial({ color: 0x151a21, toneMapped: false }));
      poster.position.set(x + side * -0.115, floorY + 2.75, z);
      poster.rotation.y = rotation;
      root.add(poster);
      posterSlots.push(poster);
    }
  }
  const hallSign = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 1.25),
    configurableLabelMaterial('soundlockHall', 'AUDITORIUM 01', 'TURN RIGHT  /  IMAX LASER'),
  );
  hallSign.position.set(-24.9, floorY + 4.88, -25.66);
  root.add(hallSign);
  addBox('door-jamb-front', [0.32, 5.4, 0.26], [-20.55, floorY + 2.7, -22.45], silver);
  addBox('door-jamb-rear', [0.32, 5.4, 0.26], [-20.55, floorY + 2.7, -18.25], silver);
  addBox('door-lintel', [0.32, 0.28, 4.45], [-20.55, floorY + 5.28, -20.35], silver);

  // Warm-white retail lighting: bright enough for a cinema foyer, but kept
  // diffuse so the pale porcelain floor never becomes a blown-out white plane.
  root.add(new THREE.HemisphereLight(0xfff7ef, 0x222a31, 0.86));
  root.add(new THREE.AmbientLight(0xfff1e5, 0.44));
  for (const [x, z, intensity] of [[-45, 2.5, 0.78], [-31, 2, 0.82], [-44, -10, 0.72], [-25, -12, 0.66]]) {
    const light = new THREE.PointLight(0xffeee2, intensity, 19, 1.7);
    light.position.set(x, floorY + 8.6, z);
    root.add(light);
  }
  const bluePool = new THREE.PointLight(0x41c7ff, 0.62, 15, 1.8);
  bluePool.position.set(-37, floorY + 7.7, -0.2);
  root.add(bluePool);

  const applyImage = (url, meshes) => {
    if (!url) return;
    loader.load(url, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      for (const mesh of meshes) {
        mesh.material.map = texture;
        mesh.material.color.setHex(0xffffff);
        mesh.material.needsUpdate = true;
      }
    });
  };
  const applyTrailer = (url, mesh, index) => {
    if (!url) return;
    const media = document.createElement('video');
    media.src = url;
    media.loop = true;
    media.muted = true;
    media.playsInline = true;
    media.preload = 'auto';
    media.disablePictureInPicture = true;
    // The physical displays are intentionally modest in size. Downsampling to
    // an intermediate canvas keeps five concurrent trailers affordable without
    // modifying or replacing the user's source files.
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = index === 4 ? 768 : 480;
    outputCanvas.height = index === 4 ? 432 : 270;
    const outputContext = outputCanvas.getContext('2d', { alpha: false, desynchronized: true });
    outputContext.fillStyle = '#020407';
    outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    const texture = new THREE.CanvasTexture(outputCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const position = mesh.getWorldPosition(new THREE.Vector3());
    const channel = {
      index,
      media,
      texture,
      mesh,
      position,
      source: null,
      panner: null,
      gain: null,
      pauseTimer: null,
      outputCanvas,
      outputContext,
      nextDrawAt: index * 9,
    };
    mediaChannels[index] = channel;
    // Once real media is configured, its animated placeholder can stay on a
    // single frame until this screen becomes the featured screen. This avoids
    // uploading five hidden canvas textures on every lobby update.
    if (trailerCanvases[index]) trailerCanvases[index].enabled = false;
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
    if (musicUnlocked) {
      ensureLobbyAudio();
      connectTrailerChannel(channel);
    }
    if (mediaActive) startTrailerChannel(channel);
  };
  loadCinemaConfig()
    .then((config) => {
      if (!config) return;
      const posters = config.posters ?? [];
      const standees = config.standees ?? [];
      const trailers = config.trailers ?? [];
      const images = config.images ?? {};
      const cinemaName = String(config.cinemaName || 'VELVET 07');
      applyConfiguredLabels(config);
      const configuredMarquee = config.marquee ?? {};
      for (const key of Object.keys(marqueeCopy)) {
        marqueeCopy[key] = resolveCinemaText(configuredMarquee[key], marqueeCopy[key], cinemaName);
      }
      marqueePanel.draw(marqueePanel.context, marqueePanel.canvas, 0);
      marqueePanel.texture.needsUpdate = true;
      applyImage(images.gameScreen || config.gameScreen || '/lobby-media/screens/game-racer-optimized.jpg', [gameScreen]);
      if (config.music) {
        configuredMusicVolume = THREE.MathUtils.clamp(Number(config.musicVolume ?? 0.28), 0, 0.65);
        lobbyMusic.src = config.music;
        lobbyMusic.load();
        syncLobbyMusic();
      }
      posterSlots.forEach((mesh, index) => applyImage(posters[index % posters.length], [mesh]));
      standeeSlots.forEach((meshes, index) => {
        const frontUrl = Array.isArray(standees)
          ? standees[index * 2] ?? standees[index % standees.length]
          : standees.front;
        const backUrl = Array.isArray(standees)
          ? standees[index * 2 + 1] ?? frontUrl
          : standees.back ?? frontUrl;
        applyImage(frontUrl, [meshes[0]]);
        applyImage(backUrl, [meshes[1]]);
      });
      trailerSlots.forEach((mesh, index) => applyTrailer(trailers[index % trailers.length], mesh, index));
    })
    .catch(() => {
      applyImage('/lobby-media/screens/game-racer-optimized.jpg', [gameScreen]);
    });
  ticketing.loadConfig();

  // The foyer is structurally static. Freezing local matrices avoids hundreds
  // of redundant transform updates while walking through it.
  root.traverse((object) => {
    if (object === root) return;
    if (object.userData.dynamic) return;
    object.updateMatrix();
    object.matrixAutoUpdate = false;
  });

  return {
    root,
    seatMeshes,
    interactionMeshes: [kioskBody, kioskScreen],
    kioskScreen,
    ticketMaterial: ticketing.ticketMaterial,
    collides(position, radius = 0.42) {
      return colliders.some((box) => Math.abs(position.x - box.x) < box.halfX + radius
        && Math.abs(position.z - box.z) < box.halfZ + radius);
    },
    setMediaActive(active) {
      if (mediaActive === active) return;
      mediaActive = active;
      if (active) mediaChannels.forEach(startTrailerChannel);
      else mediaChannels.forEach((channel) => stopTrailerChannel(channel));
    },
    setAcousticExposure(exposure) {
      acousticExposure = THREE.MathUtils.clamp(exposure, 0, 1);
      applyLobbyAcoustics();
    },
    setMusicActive(active) {
      if (musicActive === active) return;
      musicActive = active;
      syncLobbyMusic();
    },
    unlockMusic() {
      musicUnlocked = true;
      ensureLobbyAudio();
      mediaChannels.forEach((channel) => {
        if (channel) channel.media.muted = false;
      });
      syncLobbyMusic();
      if (mediaActive) mediaChannels.forEach(startTrailerChannel);
    },
    kioskActionAt(uv) {
      return ticketing.actionAtUv(uv);
    },
    setKioskHover(action) {
      ticketing.setHover(action);
    },
    activateKioskAction(action) {
      return ticketing.activate(action);
    },
    clearTicket() {
      ticketing.clear();
    },
    hasTicket() {
      return ticketing.hasTicket();
    },
    update(now, camera) {
      updateMeteor(now);
      syncLobbyListener(now, camera);
      if (mediaActive) {
        for (const channel of mediaChannels) {
          if (!channel) continue;
          if (channel.media.paused) startTrailerChannel(channel);
          const frameInterval = 1000 / (channel.index === 4 ? 24 : 18);
          if (now < channel.nextDrawAt || channel.media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) continue;
          channel.nextDrawAt = now + frameInterval;
          const { outputCanvas, outputContext, media } = channel;
          const sourceAspect = media.videoWidth / Math.max(1, media.videoHeight);
          const targetAspect = outputCanvas.width / outputCanvas.height;
          let width = outputCanvas.width;
          let height = outputCanvas.height;
          if (sourceAspect > targetAspect) height = width / sourceAspect;
          else width = height * sourceAspect;
          const x = (outputCanvas.width - width) * 0.5;
          const y = (outputCanvas.height - height) * 0.5;
          outputContext.fillStyle = '#020407';
          outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
          outputContext.drawImage(media, x, y, width, height);
          channel.texture.needsUpdate = true;
        }
      }
      if (!mediaActive || now - lastTrailerDraw < 280) return;
      lastTrailerDraw = now;
      trailerCanvases.forEach((item) => {
        if (item.enabled === false) return;
        item.draw(item.context, item.canvas, now);
        item.texture.needsUpdate = true;
      });
    },
  };
}
