"use client";

import { useLayoutEffect, useRef } from "react";

// 🎬 Opening motion for every page of every system (same feel as the system launcher):
//    the page's main blocks rise in one after another. Tagging only - the motion itself is CSS (globals.css "route reveal").
//    Pages that already have their own entrance (data-reveal / page-in / pp-page) are left alone.
//    Blocks that appear within the first moments (data finished loading) also rise in; after that nothing replays,
//    so realtime updates never re-animate.
const OWN = "[data-reveal], .page-in, .pp-page";
const WATCH_MS = 1800;
const MAX_BLOCKS = 14;

function tag(start: Element) {
  // walk down single-child wrappers to the element that holds the page's sections
  let node: Element | null = start;
  for (let d = 0; node && d < 5 && node.children.length === 1; d++)
    node = node.children[0];
  if (!node) return;
  // a long list (many cards / rows) rises as one block, so items past the cap never pop in ahead of the rest
  if (node.children.length > MAX_BLOCKS) {
    if (!node.hasAttribute("data-ri")) node.setAttribute("data-ri", "0");
    return;
  }
  let i = 0;
  for (const el of Array.from(node.children)) {
    if (el.hasAttribute("data-ri")) {
      i++;
      continue;
    }
    if (
      el.tagName === "SCRIPT" ||
      el.tagName === "STYLE" ||
      (el as HTMLElement).hidden
    )
      continue;
    el.setAttribute("data-ri", String(Math.min(i++, 7)));
  }
}

export default function AppTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  const mark = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const host = mark.current?.parentElement;
    if (!host) return;
    const pages = () => {
      const out: Element[] = [];
      for (
        let el = mark.current?.nextElementSibling;
        el;
        el = el.nextElementSibling
      )
        out.push(el);
      return out;
    };
    const run = () => {
      for (const p of pages()) {
        if (p.matches(OWN) || p.querySelector(OWN)) continue;
        tag(p);
      }
    };
    run();
    // runs before the browser paints the new blocks (microtask), so late-loaded content never flashes in first
    const mo = new MutationObserver(run);
    mo.observe(host, { childList: true, subtree: true });
    const stop = setTimeout(() => mo.disconnect(), WATCH_MS);
    return () => {
      clearTimeout(stop);
      mo.disconnect();
    };
  }, []);

  return (
    <>
      <span ref={mark} hidden data-route-mark="" />
      {children}
    </>
  );
}
