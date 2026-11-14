---
name: threejs
description: Plain three.js (no React wrapper) in CHR-NEXUS, pinned at three@0.180.0. Use when building or changing a 3D view, scene, camera, mesh, material, texture, InstancedMesh, raycasting/picking, or render loop, when a 3D page is slow or leaks memory, or when the user mentions three.js, 3D, WebGL, โมเดล 3D, ผัง 3D. For React-component style 3D, see the react-three-fiber skill.
---

# three.js in CHR-NEXUS

Version: `three@0.180.0` + `@types/three@0.180.0` (exact pins in `frontend/package.json`). Do not upgrade as a side effect; an upgrade is its own task (read the three.js Migration Guide on GitHub wiki for every release in between).

Reference in this repo: `frontend/src/app/(app)/cims/layout-3d/` (`engine.ts` = pure three.js engine, `Layout3DPage.tsx` = React wrapper, opened from `cims/store/Layout3DButton.tsx`). Copy its patterns before inventing new ones.

## 3 rules

1. **Keep three.js out of SSR and out of the first page load.**
   three.js touches `window`/WebGL, so it must never run on the server. Put the engine in a plain `.ts` file, wrap it in a `"use client"` component, and load that component with
   `dynamic(() => import("./X3DPage"), { ssr: false, loading: () => <Loading /> })` from another client component. The 3D bundle then downloads only when the user opens it.

2. **Engine object with an explicit lifecycle; React only calls it.**
   `createEngine(canvas, handlers)` returns `{ setData, setSelection, ..., dispose }`. React creates it in `useEffect`, feeds data through methods, and calls `dispose()` in the effect cleanup. `dispose()` must: cancel `requestAnimationFrame`, remove event listeners and `ResizeObserver`, call `.dispose()` on every geometry, material and texture (track them in one list, as `engine.ts` does with `keep()`), then `renderer.dispose()`. Missing this leaks GPU memory each time the page opens.

3. **Render only when something changes; batch repeated objects.**
   - Many identical objects (coils, pallets, racks) → one `InstancedMesh` per shape, set per-instance matrix/colour. Never one `Mesh` per item.
   - Draw on demand: request a frame on camera move, data change or a running animation; stop the loop when the scene is still.
   - `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`; no shadows or post-processing unless the user asks.
   - Picking: one `Raycaster`, test against a small list of pickable objects, not `scene.children` recursively.

## Checklist before done
- `npx tsc --noEmit` and `npm run lint` in `frontend/` pass.
- Open and close the 3D view several times: no console errors, memory does not climb.
- Respect `prefers-reduced-motion` for camera/scan animations.
