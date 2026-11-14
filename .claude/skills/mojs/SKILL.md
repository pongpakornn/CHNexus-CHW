---
name: mojs
description: mo.js (@mojs/core@1.7.1) motion-graphics effects in CHR-NEXUS. Use for decorative bursts and shape effects such as a success burst, like/heart pop, confetti-style particles, ripples, or a celebratory click effect, or when the user mentions mojs, mo.js, burst effect, เอฟเฟกต์ระเบิด, พลุ. Not for layout or enter/exit animations (use framer-motion via the motion skill).
---

# mo.js in CHR-NEXUS

Installed: `@mojs/core@1.7.1` (exact pin). It ships no TypeScript types; the repo declares them in `frontend/src/types/mojs.d.ts` (loose option objects). Add to that file if you use an API it does not declare yet.

## 3 rules

1. **Import it only in the browser, lazily.** The package is a UMD bundle that touches `window` the moment it is imported, so a top-level `import mojs from "@mojs/core"` breaks the server render. Load it inside an effect or event handler:
   ```tsx
   "use client";
   import { useEffect, useRef } from "react";
   import type { Burst } from "@mojs/core";

   export function useSuccessBurst() {
     const burst = useRef<Burst | null>(null);
     useEffect(() => {
       let alive = true;
       import("@mojs/core").then(({ default: mojs }) => {
         if (!alive) return;
         burst.current = new mojs.Burst({
           left: 0, top: 0, radius: { 0: 60 }, count: 8,
           children: { shape: "circle", fill: ["#2e9f6b", "#f6b02c"], radius: { 6: 0 }, duration: 600 },
         });
       });
       return () => { alive = false; burst.current?.stop(); burst.current?.el.remove(); };
     }, []);
     return (x: number, y: number) => burst.current?.tune({ x, y }).replay();
   }
   ```

2. **Create once, replay many times.** Build the `Burst`/`Shape` once (in the effect), then on each click call `.tune({ x, y }).replay()`. Creating a new effect per click adds DOM nodes that are never cleaned up. In cleanup, `stop()` it and remove its element (`.el.remove()`).

3. **Keep it short, decorative and optional.** Effects under ~800 ms, `pointer-events` never blocked, nothing important depends on them. When `prefers-reduced-motion` is on (`useReducedMotion()` from framer-motion), skip the effect entirely. Sequence several effects with `new mojs.Timeline().add(a, b)`.

Main APIs: `Shape` (one shape), `Burst` (radial particles), `Html` (animate a DOM element), `Timeline`, `Tween`, `easing.path(...)`.

## Checklist before done
- `npx tsc --noEmit` and `npm run lint` in `frontend/` pass.
- `npm run build` has no `window is not defined`.
- Clicking many times does not grow the DOM (check Elements panel).
