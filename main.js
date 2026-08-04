import * as THREE from "three";

const CHAPTER_COUNT = 6;
const IMAGE_BY_CHAPTER = {
  1: "./assets/starry.jpg?v=16",           // Home
  2: "./assets/about-cat.jpg?v=19",        // About
  3: "./assets/projects-fire.jpg",    // Projects / companies
  4: "./assets/field-cosmos.jpg?v=18",     // Field
  5: "./assets/sunflower-night.jpg?v=17",  // Work
  6: "./assets/solar-flare.jpg"       // Contact (kept)
};
const IMAGE_SAMPLE = {
  1: { mode: "stretch" },
  2: { mode: "stretch" },
  3: { mode: "stretch" },
  4: { mode: "stretch" },
  5: { mode: "stretch" },
  6: { mode: "stretch" }
};
const COLS = 140;
const ROWS = 96;
const CELL = 0.145;
const KEY_GAP = 0.84;
const KEY_DEPTH = 0.26;
const KEY_TRAVEL = 0.95;
const SPRING = 0.28;
const DAMPING = 0.78;
const PRESS_RADIUS = 2.8;
const WIPE_EDGE = 4.5;
const WIPE_PRESS = 7;
const IMAGE_BLEND = 0.35;
const JOURNEY_MAX = CHAPTER_COUNT - 1; // 5 wipes across 6 paintings
const JOURNEY_SCROLL = 0.00105;

const canvasEl = document.getElementById("pixel-stage");
const paintHint = document.getElementById("paint-hint");
const revealPctEl = document.getElementById("reveal-pct");

let currentChapter = 1;
let journey = 0;              // 0 = chapter1 · N-1 = last chapter fully revealed
let journeyTarget = 0;
let scrollSoundDebt = 0;
let lastScrollSound = 0;
let lastFrontierRow = -1;

const focus = { x: 0, y: 0, active: true, speed: 0 };
const prevFocus = { x: 0, y: 0 };
const keys = new Set();
const KEY_SPEED = 0.16;
let lastClickCell = -1;
let lastClickTime = 0;
let audioCtx = null;
let soundEnabled = true;
let masterBus = null;

const HINTS = {
  1: "Scroll — rows wipe into About",
  2: "Keep scrolling — companies catch fire next",
  3: "Keep scrolling — into the signal field",
  4: "Keep scrolling — the painting speaks for itself",
  5: "Keep scrolling — row ashore for Contact",
  6: "End of the path · scroll up to wipe back"
};

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    masterBus = audioCtx.createGain();
    masterBus.gain.value = 0.55;
    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 3200;
    filter.Q.value = 0.7;
    masterBus.connect(filter);
    filter.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

/**
 * Soft laptop-style key: short filtered noise only — no harsh buzz.
 */
function playKeyClick(intensity = 1, pitch = 0.5) {
  if (!soundEnabled) return;
  const ctx = ensureAudio();
  if (!ctx || !masterBus) return;

  const t0 = ctx.currentTime;
  const vol = 0.045 * Math.min(1, intensity);
  const p = 0.85 + pitch * 0.35;

  const dur = 0.018 + Math.random() * 0.01;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const env = Math.pow(1 - i / frames, 3.2);
    data[i] = (Math.random() * 2 - 1) * env;
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1800 * p + Math.random() * 200;
  bp.Q.value = 1.1;

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 600;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(hp);
  hp.connect(bp);
  bp.connect(gain);
  gain.connect(masterBus);
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
  const now = performance.now();
  if (now - lastClickTime < 28) return;
  lastClickTime = now;

  const pitch = ((idx % COLS) / COLS) * 0.6 + (Math.floor(idx / COLS) / ROWS) * 0.4;
  playKeyClick(0.7 + Math.min(0.35, focus.speed), pitch);
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
const ambient = new THREE.AmbientLight(0x9eb6d4, 0.5);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0xfff2d8, 1.25);
keyLight.position.set(-4, 8, 14);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x6a8cff, 0.4);
fillLight.position.set(6, -2, 8);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xffc978, 0.28);
rimLight.position.set(0, -10, 4);
scene.add(rimLight);

/** Rounded rectangle keycap profile (keyboard-style edges) */
function createKeycapGeometry(size, depth) {
  const radius = size * 0.22;
  const hw = size / 2;
  const hh = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw + radius, -hh);
  shape.lineTo(hw - radius, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + radius);
  shape.lineTo(hw, hh - radius);
  shape.quadraticCurveTo(hw, hh, hw - radius, hh);
  shape.lineTo(-hw + radius, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - radius);
  shape.lineTo(-hw, -hh + radius);
  shape.quadraticCurveTo(-hw, -hh, -hw + radius, -hh);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.14,
    bevelSize: size * 0.1,
    bevelOffset: -size * 0.02,
    bevelSegments: 2,
    curveSegments: 5
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

const keySize = CELL * KEY_GAP;
const geometry = createKeycapGeometry(keySize, KEY_DEPTH);
const material = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.42,
  metalness: 0.05,
  flatShading: false
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

/** Letterbox / pillarbox so the entire painting fits — nothing cropped */
function fitRect(img, w, h) {
  const srcAspect = img.width / img.height;
  const dstAspect = w / h;
  let dw = w;
  let dh = h;
  let dx = 0;
  let dy = 0;
  if (srcAspect > dstAspect) {
    dh = w / srcAspect;
    dy = (h - dh) / 2;
  } else {
    dw = h * srcAspect;
    dx = (w - dw) / 2;
  }
  return { dx, dy, dw, dh };
}

function sampleImage(img, opts = { mode: "fit" }) {
  const sample = document.createElement("canvas");
  sample.width = COLS;
  sample.height = ROWS;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Dark bars around contained images (match scene)
  ctx.fillStyle = "#060b14";
  ctx.fillRect(0, 0, COLS, ROWS);

  const mode = opts.mode || "fit";
  if (mode === "fit") {
    const { dx, dy, dw, dh } = fitRect(img, COLS, ROWS);
    ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
  } else if (mode === "stretch") {
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, COLS, ROWS);
  } else if (mode === "half-spread") {
    const { sx, sy, sw, sh } = halfSpreadCrop(img, opts.half || "bottom", opts.focusX ?? 0.5);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, COLS, ROWS);
  } else {
    const { sx, sy, sw, sh } = coverCrop(img, COLS, ROWS, opts.focus || { x: 0.5, y: 0.5 });
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, COLS, ROWS);
  }

  return ctx.getImageData(0, 0, COLS, ROWS).data;
}

function halfSpreadCrop(img, half = "bottom", focusX = 0.5) {
  const sh = img.height * 0.5;
  const sy = half === "top" ? 0 : img.height - sh;
  void focusX;
  return { sx: 0, sy, sw: img.width, sh };
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
      const chapterColors = {};
      for (let ch = 1; ch <= CHAPTER_COUNT; ch++) {
        chapterColors[ch] = colorFromPixels(pixelsByChapter[ch], i);
      }
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
        z: 0,
        vz: 0,
        target: 0
      });

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
  camera.updateProjectionMatrix();

  // Face-on (no tilt) — camera sits on the Z axis looking straight at the wall
  const dist = 18;
  camera.position.set(0, 0, dist);
  camera.lookAt(0, 0, 0);

  // Stretch the key wall to fill the entire screen
  const vFov = (camera.fov * Math.PI) / 180;
  const viewH = 2 * Math.tan(vFov / 2) * dist;
  const viewW = viewH * camera.aspect;
  group.scale.set(viewW / gridWidth, viewH / gridHeight, 1);
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  fitCamera();
}

function worldFromPointer() {
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(hitPlane, hitPoint)) return null;
  // Wall is non-uniformly scaled to fill the screen — map hit into local key space
  return {
    x: hitPoint.x / Math.max(group.scale.x, 0.0001),
    y: hitPoint.y / Math.max(group.scale.y, 0.0001)
  };
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
    const dx = w.x - prevFocus.x;
    const dy = w.y - prevFocus.y;
    focus.speed = Math.min(1.2, Math.hypot(dx, dy) / CELL);
    prevFocus.x = w.x;
    prevFocus.y = w.y;
    focus.x = w.x;
    focus.y = w.y;
    focus.active = true;
    tickIfNewCell();
  }
}

function measureProgress() {
  if (revealPctEl) revealPctEl.textContent = currentChapter + " / " + CHAPTER_COUNT;

  document.querySelectorAll(".chapter-dot").forEach((btn) => {
    const n = Number(btn.dataset.goto);
    btn.disabled = false;
    btn.classList.add("is-unlocked");
    btn.classList.toggle("is-active", n === currentChapter);
  });
}

/**
 * Journey 0..(CHAPTER_COUNT-1):
 * each integer step is one full top→bottom row wipe into the next painting.
 * 0 = all ch1 · 1 = all ch2 · … · 5 = all ch6
 */
function wipeState(j) {
  const clamped = Math.max(0, Math.min(JOURNEY_MAX, j));

  if (clamped <= 0.0001) {
    return { from: 1, to: 1, frontier: -WIPE_EDGE * 2 };
  }

  const wipeIndex = Math.floor(clamped);
  const local = clamped - wipeIndex;

  // Exact chapter boundary — previous wipe finished
  if (local < 0.0001) {
    const chapter = wipeIndex + 1;
    return {
      from: Math.max(1, chapter - 1),
      to: chapter,
      frontier: ROWS + WIPE_EDGE * 2
    };
  }

  return {
    from: wipeIndex + 1,
    to: Math.min(CHAPTER_COUNT, wipeIndex + 2),
    frontier: local * ROWS
  };
}

function chapterFromJourney(j) {
  // Switch UI shortly after a wipe into that chapter begins
  const n = Math.floor(j + 0.2) + 1;
  return Math.max(1, Math.min(CHAPTER_COUNT, n));
}

function journeyForChapter(n) {
  return Math.max(0, Math.min(JOURNEY_MAX, n - 1));
}

/** How far this row has flipped to the "to" image (0 = still from, 1 = fully to) */
function rowReveal(r, frontier) {
  return Math.max(0, Math.min(1, (frontier - r) / WIPE_EDGE));
}

/** Key press strength along the single wipe frontier */
function frontierPress(r, frontier, scrolling) {
  const d = Math.abs(r - frontier);
  if (d > WIPE_PRESS) return 0;
  const u = d / WIPE_PRESS;
  const strength = Math.pow(1 - u * u, 1.5);
  return strength * (scrolling ? 0.95 : 0.35);
}

function applyChapterUI(n) {
  if (n === currentChapter) {
    measureProgress();
    return;
  }
  currentChapter = n;

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

function goToChapter(n) {
  n = Math.max(1, Math.min(CHAPTER_COUNT, n));
  journeyTarget = journeyForChapter(n);
  applyChapterUI(n);
}

/**
 * Scroll drives continuous wipes: rows flip top→bottom into each next image.
 */
function handleScroll(deltaY) {
  journeyTarget = Math.max(0, Math.min(JOURNEY_MAX, journeyTarget + deltaY * JOURNEY_SCROLL));

  scrollSoundDebt += Math.abs(deltaY);
  const now = performance.now();
  if (scrollSoundDebt > 36 && now - lastScrollSound > 48) {
    scrollSoundDebt = 0;
    lastScrollSound = now;
    const { frontier } = wipeState(journeyTarget);
    const pitch = Math.max(0, Math.min(1, frontier / ROWS));
    playKeyClick(0.45 + Math.min(0.3, Math.abs(deltaY) / 140), pitch);
  }
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

  // Ease the wipe frontier down the wall
  journey += (journeyTarget - journey) * 0.085;
  if (Math.abs(journeyTarget - journey) < 0.0005) journey = journeyTarget;

  const scrolling = Math.abs(journeyTarget - journey) > 0.002;
  const { frontier, from, to } = wipeState(journey);

  const nextChapter = chapterFromJourney(journey);
  if (nextChapter !== currentChapter) applyChapterUI(nextChapter);

  // Soft tick when the frontier crosses a new row
  const fRow = Math.floor(frontier);
  if (scrolling && fRow !== lastFrontierRow && fRow >= 0 && fRow < ROWS) {
    lastFrontierRow = fRow;
    if (fRow % 2 === 0) playKeyClick(0.28, fRow / ROWS);
  }

  focus.speed *= 0.88;

  let focusC = -1;
  let focusR = -1;
  const hoverLive = focus.active;
  if (hoverLive) {
    focusC = Math.round(focus.x / CELL + COLS / 2 - 0.5);
    focusR = Math.round(ROWS / 2 - focus.y / CELL - 0.5);
  }

  const wakeRadius = PRESS_RADIUS + focus.speed * 1.8;
  const wakeRadiusSq = wakeRadius * wakeRadius;

  group.position.set(0, 0, 0);

  for (const cell of cells) {
    // Single wipe band presses keys as each row flips to the next image
    let want = frontierPress(cell.r, frontier, scrolling);

    if (hoverLive) {
      const dc = cell.c - focusC;
      const dr = cell.r - focusR;
      const gridDist = dc * dc + dr * dr;
      let hover = 0;
      if (gridDist === 0) hover = 1;
      else if (gridDist === 1) hover = 0.85;
      else if (gridDist === 2) hover = 0.55;
      else if (gridDist <= 4) hover = 0.32;
      else if (gridDist <= 8) hover = 0.16;
      else {
        const dx = (cell.x - focus.x) / CELL;
        const dy = (cell.y - focus.y) / CELL;
        const d2 = dx * dx + dy * dy;
        if (d2 < wakeRadiusSq) {
          const u = Math.sqrt(d2) / wakeRadius;
          hover = Math.pow(1 - u, 1.6) * (0.55 + focus.speed * 0.35);
        }
      }
      want = Math.max(want, hover * (1 + focus.speed * 0.45));
    }

    cell.target = want;

    const pressedZ = KEY_TRAVEL * Math.min(1.15, want);
    const force = (pressedZ - cell.z) * SPRING;
    cell.vz = (cell.vz + force) * DAMPING;
    cell.z += cell.vz;

    if (want < 0.01 && Math.abs(cell.z) < 0.001 && Math.abs(cell.vz) < 0.001) {
      cell.z = 0;
      cell.vz = 0;
    }

    dummy.position.set(cell.x, cell.y, KEY_DEPTH * 0.5 + cell.z);
    const press = Math.min(1, Math.max(0, cell.z / Math.max(KEY_TRAVEL, 0.001)));
    const sxy = 1 - press * 0.06;
    const sz = 1 - press * 0.18;
    dummy.scale.set(sxy, sxy, sz);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(cell.i, dummy.matrix);

    // Row-by-row image flip: above frontier = new painting, below = previous
    const mix = rowReveal(cell.r, frontier);
    const cFrom = cell.chapterColors[from];
    const cTo = cell.chapterColors[to];
    tmpColor.copy(cFrom).lerp(cTo, mix);
    cell.fullColor.lerp(tmpColor, IMAGE_BLEND);
    tmpColor.copy(cell.fullColor);
    if (cell.z > 0.03) {
      tmpColor.lerp(pressTint, Math.min(1, cell.z / KEY_TRAVEL) * 0.18);
    }
    mesh.setColorAt(cell.i, tmpColor);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

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
  const imgs = await Promise.all(
    Array.from({ length: CHAPTER_COUNT }, (_, i) => loadImage(IMAGE_BY_CHAPTER[i + 1]))
  );
  const pixelsByChapter = {};
  imgs.forEach((img, i) => {
    pixelsByChapter[i + 1] = sampleImage(img, IMAGE_SAMPLE[i + 1]);
  });
  buildCells(pixelsByChapter);
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
