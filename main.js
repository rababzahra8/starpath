import * as THREE from "three";

const IMAGE_SRC = "./assets/starry.jpg";
const COLS = 96;
const ROWS = 66;
const CELL = 0.2;
const KEY_DEPTH = 0.18;
const KEY_TRAVEL = 0.95;
const SPRING = 0.16;          // soft ease — less stiff
const DAMPING = 0.86;
const PRESS_RADIUS = 1.05;
const WAVE_CHAPTER = 2;
const WAVE_HALF = 10;         // wide smooth band
const WAVE_LERP = 0.1;        // how fast the ripple follows the scroll

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

/** Soft muted key tick — quieter, lower, less harsh */
function playKeyClick(intensity = 1) {
  if (!soundEnabled) return;
  const ctx = ensureAudio();
  if (!ctx) return;

  const t0 = ctx.currentTime;
  const dur = 0.05 + Math.random() * 0.02;
  const frames = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const env = Math.pow(1 - i / frames, 1.8);
    data[i] = (Math.random() * 2 - 1) * env;
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900 + Math.random() * 500;
  filter.Q.value = 0.55;

  const gain = ctx.createGain();
  const vol = 0.045 * Math.min(1, intensity);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur);
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
  playKeyClick();
}

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0a1628");

const gridWidth = COLS * CELL;
const gridHeight = ROWS * CELL;

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
camera.position.set(0, -3.2, 16);
camera.lookAt(0, 0.4, 0);

const renderer = new THREE.WebGLRenderer({
  canvas: canvasEl,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0a1628, 1);

const group = new THREE.Group();
scene.add(group);

// Full-cell cubes — no gaps, no photo peeking through
const geometry = new THREE.BoxGeometry(CELL * 1.02, CELL * 1.02, KEY_DEPTH);
const material = new THREE.MeshBasicMaterial({ color: 0xffffff });

const count = COLS * ROWS;
const mesh = new THREE.InstancedMesh(geometry, material, count);
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
  // Light lift only — keep the painting readable
  let rr = Math.min(1, r / 255 * 1.08 + 0.04);
  let gg = Math.min(1, g / 255 * 1.06 + 0.03);
  let bb = Math.min(1, b / 255 * 1.12 + 0.06);
  return new THREE.Color(rr, gg, bb);
}

function coverCrop(img, w, h) {
  const srcAspect = img.width / img.height;
  const dstAspect = w / h;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (srcAspect > dstAspect) {
    sw = img.height * dstAspect;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / dstAspect;
    sy = (img.height - sh) / 2;
  }
  return { sx, sy, sw, sh };
}

function sampleImage(img) {
  const sample = document.createElement("canvas");
  sample.width = COLS;
  sample.height = ROWS;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const { sx, sy, sw, sh } = coverCrop(img, COLS, ROWS);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, COLS, ROWS);
  return ctx.getImageData(0, 0, COLS, ROWS).data;
}

function buildCells(pixels) {
  cells.length = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const p = i * 4;
      const fullColor = vivid(pixels[p], pixels[p + 1], pixels[p + 2]);
      const x = (c - COLS / 2 + 0.5) * CELL;
      const y = (ROWS / 2 - r - 0.5) * CELL;
      const ny = r / ROWS;
      let region = 1;
      if (ny < 0.42) region = 3;
      else if (ny < 0.7) region = 2;

      cells.push({
        i, r, c, x, y, region,
        fullColor,
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
      mesh.setColorAt(i, fullColor);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
}

function fitCamera() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / Math.max(h, 1);
  // More face-on so keys clearly pop toward you (not a wavy hillside)
  const fit = Math.max(gridWidth / camera.aspect, gridHeight) * 0.78;
  camera.position.set(0, -fit * 0.08, fit * 1.35);
  camera.lookAt(0, 0, 0);
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
    if (scrollSoundDebt > 28 && now - lastScrollSound > 70) {
      scrollSoundDebt = 0;
      lastScrollSound = now;
      playKeyClick(0.55 + Math.min(0.45, Math.abs(deltaY) / 80));
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
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(cell.i, dummy.matrix);

    tmpColor.copy(cell.fullColor);
    if (cell.z > 0.04) {
      tmpColor.lerp(pressTint, Math.min(1, cell.z / KEY_TRAVEL) * 0.28);
    }
    mesh.setColorAt(cell.i, tmpColor);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  group.position.set(0, 0, 0);
  renderer.render(scene, camera);
}

async function boot() {
  bindUI();
  const img = new Image();
  img.src = IMAGE_SRC;
  await img.decode();
  buildCells(sampleImage(img));
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
