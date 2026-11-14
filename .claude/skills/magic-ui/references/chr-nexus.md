# Magic UI in CHR-NEXUS

## Already set up (do not redo)
- `frontend/components.json`: shadcn config, `@magicui` registry, components go to `src/components/ui/`.
- `frontend/src/lib/utils.ts`: `cn()` (clsx + tailwind-merge).
- Packages (exact pins): `clsx@2.1.1`, `tailwind-merge@3.7.0`, `motion@12.23.12`. `motion` is a thin wrapper over the existing `framer-motion@12.23.12` (same version, deduped). Keep both at the same version; if one is upgraded, upgrade the other.
- Installed components: `number-ticker`, `blur-fade`.

**Never run `npx shadcn init` here.** It rewrites `src/app/globals.css` (the CIMS theme: `--primary`, `--accent`, ...) and recolours the whole app.

## Adding a component (run inside `frontend/`)
1. `npx shadcn@4.23.0 add @magicui/<slug>`
2. Run `git diff src/app/globals.css`. Some components (marquee, shimmer-button, ripple, ...) append keyframes/`@theme` entries. Keep only the new keyframes/animation lines; revert anything that changes existing variables.
3. If the component lists npm dependencies, install them with `--save-exact` (this repo pins versions).

**If magicui.design is unreachable** (cloud sessions may block it): copy the source from GitHub instead, which is the same code the registry serves:
- Component: `https://raw.githubusercontent.com/magicuidesign/magicui/main/apps/www/registry/magicui/<slug>.tsx` → `src/components/ui/<slug>.tsx`
- Its npm `dependencies` and any `css`/`cssVars` (keyframes) are in that repo's `registry.json` under the item with `"name": "<slug>"`. Add keyframes to `globals.css` by hand.

## Colours: map shadcn names to CIMS tokens
Magic UI uses shadcn colour names. In this repo some do not exist, and `primary` means something else (CIMS dark grey `#49454f`, not a brand colour). Override via `className` (`cn()` lets later classes win); do not edit the component internals unless needed.

| Magic UI / shadcn class | Use in CHR-NEXUS |
|---|---|
| `bg-background` | `bg-bg` (page) or `bg-surface` (card) |
| `text-foreground`, `text-black` | `text-ink` |
| `text-muted-foreground` | `text-ink-soft` |
| `border-border`, `border` colour | `border-line` |
| `bg-primary` / `text-primary` (brand) | `bg-accent` / `text-accent` |
| `bg-muted` | `bg-surface-2` |
| success / error | `text-success`, `text-danger` |
| `dark:*` classes | harmless; the app has no dark mode |

## House rules
- Every Magic UI component is a client component (`"use client"`); keep pages as server components and import the component inside them.
- Motion timing: match the app's feel with `EASE`, `DUR`, `springSoft` from `@/lib/motion` when a component takes `transition`/`duration` props.
- Reduced motion: wrap or gate effects with `useReducedMotion()` (as `EdpAlert.tsx`, `ChartHeader.tsx` do). Background effects (`particles`, `flickering-grid`, `warp-background`) should be off when reduced motion is on.
- Internal ERP screens: at most one strong effect per view. Good fits: `number-ticker` (KPI numbers), `blur-fade` (cards entering), `animated-list` (live feed), `border-beam` (highlight one card). Avoid decorative heroes (`globe`, `marquee` logo rails) on work screens.
- Thai text: `text-animate` / `typing-animation` / `word-rotate` split by characters/words; check Thai combining vowels and tone marks are not split apart.

## Examples
```tsx
import { NumberTicker } from "@/components/ui/number-ticker";
<NumberTicker value={totalKg} decimalPlaces={0} className="text-ink text-2xl font-semibold" />
```
```tsx
import { BlurFade } from "@/components/ui/blur-fade";
{cards.map((c, i) => (
  <BlurFade key={c.id} delay={0.04 * i} inView>
    <Card {...c} />
  </BlurFade>
))}
```

Before done: `npx tsc --noEmit` and `npm run lint` in `frontend/` pass, `git diff src/app/globals.css` contains only intended additions.
