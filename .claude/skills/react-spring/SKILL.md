---
name: react-spring
description: react-spring (@react-spring/web@10.1.2) spring-physics animation in CHR-NEXUS (React 19, Next.js 16). Use when an animation should feel physical (drag release, bouncy toggle, number count-up, gesture-driven values), when animating values that change rapidly from user input, or when the user mentions react-spring, useSpring, spring animation, แอนิเมชันสปริง. For normal enter/exit and layout animations, use framer-motion (motion skill), which this repo already uses.
---

# react-spring in CHR-NEXUS

Installed: `@react-spring/web@10.1.2` (exact pin; web target only, as the README recommends).
The repo already uses `framer-motion` everywhere (`AnimatePresence`, `motion.div`, `EASE` from `@/lib/motion`). Default to framer-motion; pick react-spring only when spring physics or rapidly retargeted values are the point. Do not mix both on the same element.

## 3 rules

1. **`useSpring` + `animated.*` in a client component.**
   ```tsx
   "use client";
   import { animated, useSpring } from "@react-spring/web";

   export function FadeIn({ show, children }: { show: boolean; children: React.ReactNode }) {
     const styles = useSpring({ opacity: show ? 1 : 0, y: show ? 0 : 24 });
     return <animated.div style={styles}>{children}</animated.div>;
   }
   ```
   Only `animated.div` (or `animated.span`, `animated.svg`, ...) receives spring values; a normal `div` will not animate. Changing the target (`show`) retargets mid-flight with no jump.

2. **Tune with physics, not durations.** `config: { tension, friction }` or presets: `import { config } from "@react-spring/web"` → `config.gentle`, `config.wobbly`, `config.stiff`. Need a fixed time instead? `config: { duration: 200 }`.
   Lists enter/leave: `useTransition(items, { keys: i => i.id, from, enter, leave })`. Several things in sequence: `useChain` or `useSprings`.

3. **Imperative API for events, and respect reduced motion.**
   ```tsx
   const [styles, api] = useSpring(() => ({ x: 0 }));
   const onDrag = (dx: number) => api.start({ x: dx, immediate: true });   // follow finger
   const onRelease = () => api.start({ x: 0 });                           // spring back
   ```
   Values update outside React render (no re-render per frame). Check `useReducedMotion()` (from framer-motion, already used in this repo) and pass `immediate: true` when reduced motion is on.

Animate `transform` (`x`, `y`, `scale`, `rotate`) and `opacity`; avoid `width`/`height`/`top`/`left` (layout thrash).

## Checklist before done
- `npx tsc --noEmit` and `npm run lint` in `frontend/` pass.
- Works with reduced motion on.
