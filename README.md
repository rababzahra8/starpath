# 3D pixel wallpaper widget

## Stack

- **Plain HTML/CSS + Three.js** (loaded from a CDN as an ES module, no bundler, no npm install, no build step).
- This is the right stack for "real 3D, drop into any website": Three.js is the standard WebGL library for 3D on the web, and since you didn't mention React/Vue, plain JS means you can paste these three files into *any* site (WordPress, Webflow, a static site, a React app via an `<iframe>` or a `useEffect` that mounts it, anything) without touching a build pipeline.
- If your site *is* already React, say so and I'll wrap `main.js` into a component using `@react-three/fiber` instead — same rendering approach, different plumbing.

## How it works

- The scene is one `THREE.InstancedMesh` of ~2,700 small boxes (voxels), one per grid cell. Instancing means it's a single draw call, so it stays smooth even on phones.
- Each voxel has a target color and height computed once (sun = warm gradient + tall, mountains = two gray ridges via layered sine waves, sky = cream-to-peach gradient).
- Unpainted cells sit low and dim; painting a cell (via raycasting against an invisible plane) animates its height and color up to full over a few frames — that's the "reveal" effect.
- Moving the mouse without clicking tilts the whole group slightly (parallax). Leave it idle for a second and it auto-rotates slowly. Both use damped lerp so it feels smooth, not snappy.
- The quote is a plain HTML `<div>` overlaid on the canvas (crisp text, no font-loading step). On **Save PNG**, the code renders the 3D frame to a canvas and draws the quote text on top with Canvas2D before exporting, so the downloaded PNG matches what's on screen.

## Files

- `index.html` — markup + the import map that points `"three"` at the CDN build
- `style.css` — all styling, plain CSS custom properties, no framework
- `main.js` — the Three.js scene, grid generation, painting, camera parallax, export

## Embedding in your site

Simplest: copy the `<div id="pixel-wallpaper">...</div>` block from `index.html` into your page, include `style.css`, and include `main.js` as a `type="module"` script with the import map above it. Everything is scoped under `.pw-` class names and one `#pixel-wallpaper` id, so it won't collide with the rest of your CSS.

To change the scene (different colors, a city skyline instead of mountains, more/fewer columns for performance), edit the `cellData()` function and the `COLS`/`ROWS`/`CELL` constants at the top of `main.js`.
