import * as THREE from "three";

const IMAGE_BY_CHAPTER = {
  1: "./assets/starry.jpg",
  2: "./assets/sunflower-night.jpg", // Work — scroll wave
  3: "./assets/solar-flare.jpg"      // Contact
};
// How each page maps its image onto the landscape wall.
// cover = crop to fill · half-spread = use half the portrait height, stretch full-width horizontally
const IMAGE_SAMPLE = {
  1: { mode: "cover", focus: { x: 0.5, y: 0.45 } },
  2: { mode: "cover", focus: { x: 0.5, y: 0.5 } },
  3: { mode: "cover", focus: { x: 0.5, y: 0.5 } }
};
const COLS = 140;
const ROWS = 96;
const CELL = 0.145;
const KEY_GAP = 0.86;         // footprint vs cell — gaps read as key edges
const KEY_DEPTH = 0.28;       // taller caps so sides catch light
const KEY_TRAVEL = 0.72;
const SPRING = 0.18;
const DAMPING = 0.84;
const PRESS_RADIUS = 1.15;
const WAVE_CHAPTER = 2;
const WAVE_HALF = 14;
const WAVE_LERP = 0.1;
const IMAGE_BLEND = 0.22;

const canvasEl = document.getElementById("pixel-stage");
const paintHint = document.getElementById("paint-hint");
const revealPctEl = document.getElementById("reveal-pct");

let currentChapter = 1;
let waveCenter = ROWS * 0.35;
let waveTarget = waveCenter;
let waveActive = 0;           // 0..1 fade of scroll wave strength
let scrollLocked = false;
let scrollSoundDebt = 0;
let lastScrollSound = 0;
let edgeHold = 0;

const focus = { x: 0, y: 0, active: true };
const keys = new Set();
const KEY_SPEED = 0.16;
let lastClickCell = -1;
let audioCtx = null;
let soundEnabled = true;

const HINTS = {
  1: "Scroll to change page · hover keys click",
  2: "Scroll smoothly — the wall glides with soft ticks",
  3: "Scroll up for Work · hover still clicks keys"
};

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

/** Dense mechanical key tick — short noise + soft body tone */
function playKeyClick(intensity = 1) {
  if (!soundEnabled) return;
  const ctx = ensureAudio();
  if (!ctx) return;

  const t0 = ctx.currentTime;
  const vol = 0.07 * Math.min(1.2, intensity);

  // Click transient (noise burst)
  const dur = 0.028 + Math.random() * 0.018;
  const frames = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const env = Math.pow(1 - i / frames, 2.4);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1400 + Math.random() * 1600;
  bp.Q.value = 0.9;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(vol, t0);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  noise.connect(bp);
  bp.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(t0);
  noise.stop(t0 + dur);

  // Soft keyed body (triangle thump)
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(180 + Math.random() * 90, t0);
  osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.05);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(vol * 0.35, t0);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);
  osc.connect(oscGain);
  oscGain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.06);
}

/** Fire a tight cluster of ticks — denser feel while scrolling/hovering */
function playKeyCluster(count = 3, intensity = 0.7) {
  if (!soundEnabled) return;
  for (let i = 0; i < count; i++) {
    const delay = i * (8 + Math.random() * 10);
    window.setTimeout(() => playKeyClick(intensity * (0.7 + Math.random() * 0.4)), delay);
  }
}

function cellIndexFromFocus() {
  const c = Math.round(focus.x / CELL + COLS / 2 - 0.5);
  const r = Math.round(ROWS / 2 - focus.y / CELL - 0.5);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1;
  return r * COLS + c;
}

function tickIfNewCell() {
  const idx = cellIndexFromFocus();
  if (idx < 0 || idx === lastClickCell) return;
  lastClickCell = idx;
  playKeyClick(0.95);
  // Neighbor taps for denser keyboard chatter
  if (Math.random() < 0.55) playKeyClick(0.35 + Math.random() * 0.25);
  if (Math.random() < 0.25) playKeyClick(0.2 + Math.random() * 0.2);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color("#060b14");

const gridWidth = COLS * CELL;
const gridHeight = ROWS * CELL;

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
camera.position.set(0, -3.2, 16);
camera.lookAt(0, 0.4, 0);

const renderer = new THREE.WebGLRenderer({
  canvas: canvasEl,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x060b14, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const group = new THREE.Group();
scene.add(group);

// Soft keycap lighting — tops bright, sides fall off like real keys
const ambient = new THREE.AmbientLight(0x9eb6d4, 0.55);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0xfff2d8, 1.15);
keyLight.position.set(-4, 8, 14);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x6a8cff, 0.35);
fillLight.position.set(6, -2, 8);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xffc978, 0.25);
rimLight.position.set(0, -10, 4);
scene.add(rimLight);

// Beveled-ish keycaps: slightly inset top face via shallow box + gaps between keys
const keySize = CELL * KEY_GAP;
const geometry = new THREE.BoxGeometry(keySize, keySize, KEY_DEPTH, 1, 1, 1);
const material = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.48,
  metalness: 0.06,
  flatShading: true
});

const count = COLS * ROWS;
const mesh = new THREE.InstancedMesh(geometry, material, count);
mesh.castShadow = false;
mesh.receiveShadow = false;
group.add(mesh);

const cells = [];
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
const pressTint = new THREE.Color("#ffe566");

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(0, 0);
const hitPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hitPoint = new THREE.Vector3();

function vivid(r, g, b) {
  // Stronger contrast + slight saturation so brushwork stays readable on the wall
  let rr = r / 255;
  let gg = g / 255;
  let bb = b / 255;
  const contrast = 1.18;
  rr = (rr - 0.5) * contrast + 0.5;
  gg = (gg - 0.5) * contrast + 0.5;
  bb = (bb - 0.5) * contrast + 0.5;
  const avg = (rr + gg + bb) / 3;
  const sat = 1.12;
  rr = avg + (rr - avg) * sat;
  gg = avg + (gg - avg) * sat;
  bb = avg + (bb - avg) * sat;
  return new THREE.Color(
    Math.min(1, Math.max(0, rr)),
    Math.min(1, Math.max(0, gg)),
    Math.min(1, Math.max(0, bb))
  );
}

function coverCrop(img, w, h, focus = { x: 0.5, y: 0.5 }) {
  const srcAspect = img.width / img.height;
  const dstAspect = w / h;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (srcAspect > dstAspect) {
    sw = img.height * dstAspect;
    sx = Math.max(0, Math.min(img.width - sw, img.width * focus.x - sw / 2));
  } else {
    sh = img.width / dstAspect;
    sy = Math.max(0, Math.min(img.height - sh, img.height * focus.y - sh / 2));
  }
  return { sx, sy, sw, sh };
}

/** Half of a tall image, stretched across the landscape wall. */
function halfSpreadCrop(img, half = "bottom", focusX = 0.5) {
  const sh = img.height * 0.5;
  const sy = half === "top" ? 0 : img.height - sh;
  // Full width of the painting, laid out horizontally on the wall
  void focusX;
  return { sx: 0, sy, sw: img.width, sh };
}

function sampleImage(img, opts = { mode: "cover", focus: { x: 0.5, y: 0.5 } }) {
  const sample = document.createElement("canvas");
  sample.width = COLS;
  sample.height = ROWS;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  let crop;
  if (opts.mode === "half-spread") {
    crop = halfSpreadCrop(img, opts.half || "bottom", opts.focusX ?? 0.5);
  } else if (opts.mode === "stretch") {
    crop = { sx: 0, sy: 0, sw: img.width, sh: img.height };
  } else {
    crop = coverCrop(img, COLS, ROWS, opts.focus || { x: 0.5, y: 0.5 });
  }

  const { sx, sy, sw, sh } = crop;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, COLS, ROWS);
  return ctx.getImageData(0, 0, COLS, ROWS).data;
}

function colorFromPixels(pixels, i) {
  const p = i * 4;
  return vivid(pixels[p], pixels[p + 1], pixels[p + 2]);
}

function buildCells(pixelsByChapter) {
  cells.length = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const chapterColors = {
        1: colorFromPixels(pixelsByChapter[1], i),
        2: colorFromPixels(pixelsByChapter[2], i),
        3: colorFromPixels(pixelsByChapter[3], i)
      };
      const x = (c - COLS / 2 + 0.5) * CELL;
      const y = (ROWS / 2 - r - 0.5) * CELL;
      const ny = r / ROWS;
      let region = 1;
      if (ny < 0.42) region = 3;
      else if (ny < 0.7) region = 2;

      cells.push({
        i, r, c, x, y, region,
        chapterColors,
        fullColor: chapterColors[1].clone(),
        visited: 0,
        // spring state: z=0 flush in wall, positive z = toward camera
        z: 0,
        vz: 0,
        target: 0
      });

      // Flat rigid wall — every key same resting depth
      dummy.position.set(x, y, KEY_DEPTH * 0.5);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, chapterColors[1]);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
}

function fitCamera() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / Math.max(h, 1);
  // Slight rake so key sides / edges read in 3D
  const fit = Math.max(gridWidth / camera.aspect, gridHeight) * 0.78;
  camera.position.set(0, -fit * 0.28, fit * 1.32);
  camera.lookAt(0, 0.05, KEY_DEPTH * 0.15);
  camera.updateProjectionMatrix();
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  fitCamera();
}

function worldFromPointer() {
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(hitPlane, hitPoint)) return null;
  return { x: hitPoint.x, y: hitPoint.y };
}

function setPointerFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  const clientX = e.clientX ?? e.touches?.[0]?.clientX;
  const clientY = e.clientY ?? e.touches?.[0]?.clientY;
  if (clientX == null) return;
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  const w = worldFromPointer();
  if (w) {
    focus.x = w.x;
    focus.y = w.y;
    focus.active = true;
    tickIfNewCell();
  }
}

function measureProgress() {
  if (revealPctEl) revealPctEl.textContent = currentChapter + " / 3";

  document.querySelectorAll(".chapter-dot").forEach((btn) => {
    const n = Number(btn.dataset.goto);
    btn.disabled = false;
    btn.classList.add("is-unlocked");
    btn.classList.toggle("is-active", n === currentChapter);
  });
}

function goToChapter(n) {
  n = Math.max(1, Math.min(3, n));
  if (n === currentChapter) {
    measureProgress();
    return;
  }
  currentChapter = n;

  // Snap wall to the new page image so the swap is obvious
  for (const cell of cells) {
    cell.fullColor.copy(cell.chapterColors[n]);
    mesh.setColorAt(cell.i, cell.fullColor);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  if (n !== WAVE_CHAPTER) {
    waveActive = 0;
    for (const cell of cells) cell.target = 0;
  } else {
    waveTarget = waveCenter;
    waveActive = 0.5;
  }

  document.querySelectorAll(".page").forEach((page) => {
    const ch = Number(page.dataset.chapter);
    const active = ch === n;
    page.classList.toggle("is-active", active);
    page.hidden = !active;
    page.inert = !active;
    page.setAttribute("aria-hidden", active ? "false" : "true");
  });

  if (paintHint) paintHint.textContent = HINTS[n];
  measureProgress();
}

/** Soft gaussian band of targets from continuous waveCenter */
function updateScrollWaveTargets() {
  if (currentChapter !== WAVE_CHAPTER || waveActive < 0.02) {
    if (currentChapter !== WAVE_CHAPTER) return;
    // fade targets down gently
    for (const cell of cells) {
      cell.target *= 0.9;
      if (cell.target < 0.02) cell.target = 0;
    }
    return;
  }

  for (const cell of cells) {
    const d = Math.abs(cell.r - waveCenter);
    if (d > WAVE_HALF) {
      cell.target = 0;
      continue;
    }
    // smooth falloff (not a hard step)
    const u = d / WAVE_HALF;
    const strength = Math.pow(1 - u * u, 1.6) * waveActive;
    cell.target = strength;
  }
}

/**
 * Page 2: continuous smooth scroll ripple (no chunky steps).
 * Other pages: scroll still changes page.
 */
function handleScroll(deltaY) {
  if (currentChapter === WAVE_CHAPTER) {
    // Continuous — no lock stutter
    waveTarget += deltaY * 0.028;
    waveActive = Math.min(1, waveActive + 0.35);

    if (waveTarget > ROWS - 1) {
      edgeHold += deltaY;
      waveTarget = ROWS - 1;
      if (edgeHold > 180) {
        edgeHold = 0;
        goToChapter(3);
      }
    } else if (waveTarget < 0) {
      edgeHold += -deltaY;
      waveTarget = 0;
      if (edgeHold > 180) {
        edgeHold = 0;
        goToChapter(1);
      }
    } else {
      edgeHold = 0;
    }

    scrollSoundDebt += Math.abs(deltaY);
    const now = performance.now();
    if (scrollSoundDebt > 8 && now - lastScrollSound > 22) {
      const burst = Math.min(5, 2 + Math.floor(Math.abs(deltaY) / 25));
      scrollSoundDebt = 0;
      lastScrollSound = now;
      playKeyCluster(burst, 0.55 + Math.min(0.55, Math.abs(deltaY) / 70));
    }
    return;
  }

  if (scrollLocked) return;
  if (Math.abs(deltaY) < 14) return;
  scrollLocked = true;
  if (deltaY > 0) goToChapter(currentChapter + 1);
  else goToChapter(currentChapter - 1);
  window.setTimeout(() => { scrollLocked = false; }, 550);
}

function bindUI() {
  document.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      goToChapter(Number(el.dataset.goto));
    });
  });

  window.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) < 1) return;
    handleScroll(e.deltaY);
  }, { passive: true });

  let touchY = null;
  window.addEventListener("touchstart", (e) => {
    touchY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener("touchend", (e) => {
    if (touchY == null) return;
    const dy = touchY - e.changedTouches[0].clientY;
    touchY = null;
    if (Math.abs(dy) < 40) return;
    handleScroll(dy);
  }, { passive: true });

  window.addEventListener("pointermove", setPointerFromEvent, { passive: true });
  window.addEventListener("pointerdown", (e) => {
    ensureAudio();
    setPointerFromEvent(e);
  }, { passive: true });
  window.addEventListener("resize", resize);

  document.getElementById("btn-sound")?.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    ensureAudio();
    const btn = document.getElementById("btn-sound");
    if (btn) btn.textContent = soundEnabled ? "Sound: on" : "Sound: off";
    if (soundEnabled) playKeyClick();
  });

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "pagedown" || (k === " " && !e.target.closest("input, textarea"))) {
      e.preventDefault();
      handleScroll(40);
      return;
    }
    if (k === "pageup") {
      e.preventDefault();
      handleScroll(-40);
      return;
    }
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) {
      keys.add(k);
      focus.active = true;
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
}

function updateKeyboardFocus() {
  if (!keys.size) return;
  if (keys.has("arrowleft") || keys.has("a")) focus.x -= KEY_SPEED;
  if (keys.has("arrowright") || keys.has("d")) focus.x += KEY_SPEED;
  if (keys.has("arrowup") || keys.has("w")) focus.y += KEY_SPEED;
  if (keys.has("arrowdown") || keys.has("s")) focus.y -= KEY_SPEED;
  focus.x = Math.max(-gridWidth / 2, Math.min(gridWidth / 2, focus.x));
  focus.y = Math.max(-gridHeight / 2, Math.min(gridHeight / 2, focus.y));
  tickIfNewCell();
}

function animate() {
  requestAnimationFrame(animate);
  updateKeyboardFocus();

  // Smooth follow for scroll ripple
  if (currentChapter === WAVE_CHAPTER) {
    waveCenter += (waveTarget - waveCenter) * WAVE_LERP;
    waveActive *= 0.985; // gentle settle when you stop scrolling
    if (waveActive < 0.04) waveActive = 0;
    updateScrollWaveTargets();
  }

  let focusC = -1;
  let focusR = -1;
  const hoverLive = focus.active;
  if (hoverLive) {
    focusC = Math.round(focus.x / CELL + COLS / 2 - 0.5);
    focusR = Math.round(ROWS / 2 - focus.y / CELL - 0.5);
  }

  const radiusSq = PRESS_RADIUS * PRESS_RADIUS;
  const chapterColorKey = currentChapter;

  for (const cell of cells) {
    let want = cell.target;
    if (hoverLive) {
      const dc = cell.c - focusC;
      const dr = cell.r - focusR;
      const gridDist = dc * dc + dr * dr;
      let hover = 0;
      if (gridDist === 0) hover = 1;
      else if (gridDist === 1) hover = 0.65;
      else if (gridDist === 2) hover = 0.3;
      else {
        const dx = cell.x - focus.x;
        const dy = cell.y - focus.y;
        if (dx * dx + dy * dy < radiusSq * CELL * CELL) hover = 0.12;
      }
      want = Math.max(want, hover);
    }

    const pressedZ = KEY_TRAVEL * want;
    const force = (pressedZ - cell.z) * SPRING;
    cell.vz = (cell.vz + force) * DAMPING;
    cell.z += cell.vz;

    if (want < 0.01 && Math.abs(cell.z) < 0.001 && Math.abs(cell.vz) < 0.001) {
      cell.z = 0;
      cell.vz = 0;
    }

    dummy.position.set(cell.x, cell.y, KEY_DEPTH * 0.5 + cell.z);
    // Slight squash when pressed — reads like a real keycap
    const press = Math.min(1, Math.max(0, cell.z / Math.max(KEY_TRAVEL, 0.001)));
    const sxy = 1 - press * 0.04;
    const sz = 1 - press * 0.12;
    dummy.scale.set(sxy, sxy, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(cell.i, dummy.matrix);

    cell.fullColor.lerp(cell.chapterColors[chapterColorKey], IMAGE_BLEND);
    tmpColor.copy(cell.fullColor);
    if (cell.z > 0.04) {
      tmpColor.lerp(pressTint, Math.min(1, cell.z / KEY_TRAVEL) * 0.14);
    }
    mesh.setColorAt(cell.i, tmpColor);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  group.position.set(0, 0, 0);
  renderer.render(scene, camera);
}

async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

async function boot() {
  bindUI();
  const [img1, img2, img3] = await Promise.all([
    loadImage(IMAGE_BY_CHAPTER[1]),
    loadImage(IMAGE_BY_CHAPTER[2]),
    loadImage(IMAGE_BY_CHAPTER[3])
  ]);
  buildCells({
    1: sampleImage(img1, IMAGE_SAMPLE[1]),
    2: sampleImage(img2, IMAGE_SAMPLE[2]),
    3: sampleImage(img3, IMAGE_SAMPLE[3])
  });
  resize();
  goToChapter(1);
  focus.x = 0;
  focus.y = -gridHeight * 0.15;
  requestAnimationFrame(animate);
}

boot().catch((err) => {
  console.error(err);
  if (paintHint) paintHint.textContent = "Could not load the night sky.";
});
