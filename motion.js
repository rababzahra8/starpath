/**
 * Starpath motion polish — vanilla modules (site is not React).
 * Soft premium reveals + cursor + micro-interactions; layout/colors stay put.
 * Respects prefers-reduced-motion.
 */
import gsap from "gsap";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;

let whooshCtx = null;
let whooshEnabled = true;

export function setMotionSoundEnabled(on) {
  whooshEnabled = on;
}

/** Soft section-change whoosh — never autoplays alone. */
export function playWhoosh() {
  if (!whooshEnabled || reduceMotion) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!whooshCtx) whooshCtx = new AC();
    if (whooshCtx.state === "suspended") whooshCtx.resume();
    const t0 = whooshCtx.currentTime;
    const buf = whooshCtx.createBuffer(1, Math.floor(whooshCtx.sampleRate * 0.22), whooshCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const u = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - u, 2.4) * 0.35;
    }
    const src = whooshCtx.createBufferSource();
    src.buffer = buf;
    const filter = whooshCtx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.55;
    const gain = whooshCtx.createGain();
    gain.gain.setValueAtTime(0.04, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(whooshCtx.destination);
    src.start(t0);
    src.stop(t0 + 0.22);
  } catch {
    /* ignore */
  }
}

/* —— Custom mosaic cursor —— */
let cursorEl;
let trail = [];
let cx = 0;
let cy = 0;
let tx = 0;
let ty = 0;
let cursorMode = "dot";

function ensureCursor() {
  if (!finePointer || reduceMotion || cursorEl) return;
  document.documentElement.classList.add("has-custom-cursor");
  const stage = document.getElementById("pixel-stage");
  if (stage) stage.style.cursor = "none";
  document.body.style.cursor = "none";
  cursorEl = document.createElement("div");
  cursorEl.className = "sp-cursor";
  cursorEl.innerHTML = `<span class="sp-cursor-core"></span>`;
  document.body.appendChild(cursorEl);

  for (let i = 0; i < 8; i++) {
    const p = document.createElement("span");
    p.className = "sp-cursor-trail";
    document.body.appendChild(p);
    trail.push({ el: p, x: 0, y: 0 });
  }

  window.addEventListener(
    "pointermove",
    (e) => {
      tx = e.clientX;
      ty = e.clientY;
      cursorEl.classList.add("is-on");
    },
    { passive: true }
  );

  // Slight scale only — no Open/Enter label pills
  document.addEventListener("pointerover", (e) => {
    const hit = e.target.closest(
      "a, button, [data-goto], .experiment, .experiment-enter, .connect-cta, .chapter-dot, .brand"
    );
    setCursorMode(hit ? "grow" : "dot");
  });

  // Magnetic pull for links / CTA — tiny, premium
  document.addEventListener(
    "pointermove",
    (e) => {
      const link = e.target.closest(".name-links a, .connect-cta, .experiment-enter");
      if (!link || reduceMotion) return;
      const r = link.getBoundingClientRect();
      const mx = e.clientX - (r.left + r.width / 2);
      const my = e.clientY - (r.top + r.height / 2);
      const pull = link.matches(".connect-cta") ? 0.22 : 0.16;
      link.style.transform = `translate3d(${mx * pull}px, ${my * pull}px, 0)`;
    },
    { passive: true }
  );

  document.addEventListener(
    "pointerout",
    (e) => {
      const link = e.target.closest(".name-links a, .connect-cta, .experiment-enter");
      if (link) link.style.transform = "";
    },
    { passive: true }
  );

  // Tip snaps to the pointer; trail pixels each ease toward tip (not a broken chain)
  const tick = () => {
    cx = tx;
    cy = ty;
    if (cursorEl) {
      cursorEl.style.transform = `translate3d(${Math.round(cx)}px, ${Math.round(cy)}px, 0)`;
    }
    const n = trail.length;
    for (let i = 0; i < n; i++) {
      const t = trail[i];
      const ease = 0.42 - i * 0.04;
      t.x += (cx - t.x) * ease;
      t.y += (cy - t.y) * ease;
      const scale = 1 - (i + 1) * 0.09;
      const alpha = Math.max(0, 0.7 * (1 - (i + 1) / (n + 1)));
      t.el.style.transform = `translate3d(${Math.round(t.x)}px, ${Math.round(t.y)}px, 0) scale(${scale})`;
      t.el.style.opacity = String(alpha);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setCursorMode(mode) {
  if (!cursorEl) return;
  if (mode === cursorMode) return;
  cursorMode = mode;
  cursorEl.dataset.mode = mode;
}

/* —— Nav sliding pill —— */
let navPill;

function ensureNavPill() {
  const nav = document.querySelector(".chapters");
  if (!nav || navPill) return;
  navPill = document.createElement("span");
  navPill.className = "chapters-pill";
  navPill.setAttribute("aria-hidden", "true");
  nav.prepend(navPill);
  moveNavPill(true);
}

export function moveNavPill(instant = false) {
  if (!navPill) return;
  const active = document.querySelector(".chapter-dot.is-active");
  if (!active) return;
  const nav = active.parentElement;
  const nr = nav.getBoundingClientRect();
  const ar = active.getBoundingClientRect();
  const x = ar.left - nr.left;
  const y = ar.top - nr.top;
  gsap.to(navPill, {
    width: ar.width,
    height: ar.height,
    x,
    y,
    duration: reduceMotion || instant ? 0 : 0.45,
    ease: "power3.out"
  });
}

/* —— Chapter content reveals —— */
let lastRevealChapter = -1;

export function revealChapter(n) {
  if (n === lastRevealChapter) return;
  const firstReveal = lastRevealChapter < 0;
  lastRevealChapter = n;
  if (!reduceMotion && !firstReveal) playWhoosh();

  const page = document.querySelector(`.page[data-chapter="${n}"]`);
  if (!page) return;
  const plaque = page.querySelector(".plaque");
  if (!plaque) return;

  try {
    if (reduceMotion) {
      gsap.set(plaque, { clearProps: "all" });
      moveNavPill(true);
      return;
    }

    const heading = plaque.querySelector(".display, .display--sm");
    const lines = plaque.querySelectorAll(
      ".story p, .plaque-lede, .orbit-trail > li, .experiment, .interest-run li, .grow-item"
    );
    const rest = plaque.querySelectorAll(".plaque-num, .connect-cta, .name-links, .experiment-enter");
    const killList = [plaque, ...rest];
    if (heading) killList.push(heading);
    if (lines.length) killList.push(...lines);
    gsap.killTweensOf(killList);

    // Soft plaque settle — no heading bob / mask
    gsap.fromTo(
      plaque,
      { autoAlpha: 0.75, y: 12 },
      { autoAlpha: 1, y: 0, duration: 0.55, ease: "power2.out" }
    );

    if (heading) {
      gsap.set(heading, { clearProps: "clipPath,transform,y" });
      gsap.fromTo(
        heading,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.45, ease: "power2.out", delay: 0.04 }
      );
    }

    if (lines.length) {
      gsap.fromTo(
        lines,
        { y: 10, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.06, ease: "power2.out", delay: 0.1 }
      );
    }

    if (n === 4) runGardenAmbient(page);
    else stopGardenWind();
    if (n === 5) bindConnectTilt(page);

    moveNavPill();
  } catch (err) {
    console.warn("revealChapter:", err);
    moveNavPill(true);
  }
}

function runGardenAmbient(page) {
  if (reduceMotion) return;
  const plaque = page.querySelector(".plaque");
  if (!plaque) return;
  let layer = plaque.querySelector(".garden-dust");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "garden-dust";
    layer.setAttribute("aria-hidden", "true");
    plaque.appendChild(layer);
    for (let i = 0; i < 12; i++) {
      const s = document.createElement("span");
      layer.appendChild(s);
      gsap.set(s, {
        x: `${Math.random() * 100}%`,
        y: `${Math.random() * 100}%`,
        opacity: 0.15 + Math.random() * 0.35,
        scale: 0.4 + Math.random() * 0.8
      });
      gsap.to(s, {
        x: `+=${gsap.utils.random(-24, 24)}`,
        y: `+=${gsap.utils.random(-30, 18)}`,
        duration: gsap.utils.random(4, 8),
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut"
      });
    }
  }

  // Very slight wind on existing star-dust layer
  const dust = document.querySelector(".star-dust");
  if (dust) {
    gsap.killTweensOf(dust);
    gsap.to(dust, {
      x: 10,
      y: -6,
      duration: 7,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut"
    });
  }
}

function stopGardenWind() {
  const dust = document.querySelector(".star-dust");
  if (dust) {
    gsap.killTweensOf(dust);
    gsap.to(dust, { x: 0, y: 0, duration: 0.8, ease: "power2.out" });
  }
}

/** Connect: CTA magnetic + plaque tilt with pointer */
function bindConnectTilt(page) {
  const plaque = page.querySelector(".plaque--connect");
  const cta = page.querySelector(".connect-cta");
  if (!plaque || plaque.dataset.tilt === "1") return;
  plaque.dataset.tilt = "1";

  if (cta) {
    cta.addEventListener("pointerenter", () => cta.classList.add("is-hot"));
    cta.addEventListener("pointerleave", () => {
      cta.classList.remove("is-hot");
      cta.style.transform = "";
    });
  }

  if (reduceMotion) return;

  page.addEventListener(
    "pointermove",
    (e) => {
      if (!page.classList.contains("is-active")) return;
      const r = plaque.getBoundingClientRect();
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width * 0.5);
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height * 0.5);
      // A few degrees only — ambient, not dizzy
      plaque.style.transform = `perspective(900px) rotateY(${nx * 2.2}deg) rotateX(${-ny * 1.6}deg)`;
    },
    { passive: true }
  );
  page.addEventListener(
    "pointerleave",
    () => {
      plaque.style.transform = "";
    },
    { passive: true }
  );
}

/* —— Experiments hover + soft exit into project —— */
export function bindExperiments(playClick) {
  const list = document.querySelector(".experiment-list");
  if (!list || list.dataset.bound === "1") return;
  list.dataset.bound = "1";

  list.querySelectorAll(".experiment").forEach((row) => {
    row.addEventListener("pointerenter", () => {
      list.classList.add("is-dimming");
      row.classList.add("is-hot");
      if (typeof playClick === "function") playClick(0.25, 0.55);
    });
    row.addEventListener("pointerleave", () => {
      row.classList.remove("is-hot");
      if (!list.querySelector(".experiment.is-hot")) list.classList.remove("is-dimming");
    });

    const enter = row.querySelector(".experiment-enter");
    if (!enter || reduceMotion) return;
    enter.addEventListener("click", (e) => {
      // Soft dissolve before leaving — external project pages can't share a route
      if (enter.dataset.leaving === "1") return;
      e.preventDefault();
      enter.dataset.leaving = "1";
      const href = enter.href;
      const page = document.querySelector('.page[data-chapter="3"]');
      gsap.to(page?.querySelector(".plaque") || row, {
        autoAlpha: 0.35,
        scale: 1.015,
        filter: "blur(2px)",
        duration: 0.38,
        ease: "power2.inOut",
        onComplete: () => {
          window.open(href, "_blank", "noopener,noreferrer");
          gsap.to(page?.querySelector(".plaque") || row, {
            autoAlpha: 1,
            scale: 1,
            filter: "blur(0px)",
            duration: 0.45,
            ease: "power2.out",
            onComplete: () => {
              enter.dataset.leaving = "0";
            }
          });
        }
      });
    });
  });
}

/** Subtle wall parallax — GPU transform only, tiny range */
export function wallParallax(group, nx, ny, reduce) {
  if (!group || reduce || reduceMotion) {
    if (group) group.rotation.set(0, 0, 0);
    return;
  }
  group.rotation.y = nx * 0.035;
  group.rotation.x = -ny * 0.028;
}

export function initMotion({ playClick } = {}) {
  ensureCursor();
  ensureNavPill();
  bindExperiments(playClick);
  moveNavPill(true);
  window.addEventListener("resize", () => moveNavPill(true), { passive: true });
}

export { reduceMotion, finePointer };
