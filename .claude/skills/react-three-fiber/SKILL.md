---
name: react-three-fiber
description: React Three Fiber (@react-three/fiber@9.8.2) in CHR-NEXUS, on three@0.180.0 and React 19 / Next.js 16. Use when writing 3D as React components (<Canvas>, <mesh>, useFrame, useThree), adding a small 3D widget or interactive 3D element to a page, or when the user mentions R3F, react-three-fiber, @react-three, Canvas 3D. For a large, performance-critical 3D engine, see the threejs skill.
---

# React Three Fiber in CHR-NEXUS

Installed: `@react-three/fiber@9.8.2` (exact pin). Peer range: React `>=19 <19.4`, three `>=0.156`. If React is upgraded to 19.4+, R3F must be upgraded with it.
Not installed: `@react-three/drei` (helpers such as OrbitControls, Text, useGLTF). Ask before adding it.

## When R3F vs plain three.js
- R3F: small/medium scenes, UI-driven 3D, a few dozen objects, state from React.
- Plain three.js engine (see `threejs` skill, `cims/layout-3d/engine.ts`): thousands of objects, custom render loop, tight performance control.

## 3 rules

1. **Client-only, lazy loaded.** The file with `<Canvas>` starts with `"use client"`. Load it from a client component via `dynamic(() => import("./Scene"), { ssr: false })` so three.js is not in the server render or the first page load.

   ```tsx
   "use client";
   import { Canvas } from "@react-three/fiber";
   export default function Scene() {
     return (
       <Canvas camera={{ position: [0, 2, 5], fov: 50 }} dpr={[1, 2]} frameloop="demand">
         <ambientLight intensity={0.6} />
         <directionalLight position={[3, 5, 2]} />
         <Box />
       </Canvas>
     );
   }
   ```

2. **Animate in `useFrame` by mutating refs, never with React state.**
   ```tsx
   const ref = useRef<THREE.Mesh>(null);
   useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt; });
   ```
   `setState` inside `useFrame` re-renders React 60 times a second. Read `dt` so speed does not depend on frame rate. Hooks `useFrame`/`useThree` work only inside `<Canvas>`.
   With `frameloop="demand"`, call `invalidate()` (from `useThree`) after changing something outside `useFrame`.

3. **Create heavy objects once.** Use JSX (`<boxGeometry />`, `<meshStandardMaterial />`) or `useMemo` for geometry/material/texture; never `new THREE.X()` in the render body. Many identical items → `<instancedMesh args={[geo, mat, count]}>`. R3F disposes JSX-created objects on unmount; things you created yourself with `new` you dispose yourself.

Events: `onClick`, `onPointerOver` etc. work directly on meshes (R3F raycasts for you). Call `e.stopPropagation()` to hit only the front object.

## Checklist before done
- `npx tsc --noEmit` and `npm run lint` in `frontend/` pass.
- No `window is not defined` in `npm run build`.
- Reduced motion respected for auto-rotation/animations.
