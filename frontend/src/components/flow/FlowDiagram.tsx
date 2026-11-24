"use client";

import { useEffect, useRef, useState } from "react";
import "./flow-diagram.css";

// 🔀 Flow diagram (left -> right): columns of node cards · every node of a column links to every node of the next one (curved lines)
//   used by KANBAN › PREVIEW FLOW and MASTER DATA › Zone & Workstation Information · horizontal scroll on small screens
//   lines are measured from the real card positions (ResizeObserver) so they stay right when text wraps or the window resizes
export type FlowNode = { id: string; title: string; sub?: string; meta?: React.ReactNode; color: string; icon?: React.ReactNode; muted?: boolean };
export type FlowColumn = { key: string; label?: string; sub?: string; nodes: FlowNode[] };

type Line = { d: string; color: string; i: number };

export function FlowDiagram({ columns, ariaLabel }: { columns: FlowColumn[]; ariaLabel: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const draw = () => {
      // layout position inside the diagram (offset chain, not screen rects: a modal scaling in would skew screen rects)
      const rect = (id: string) => {
        const n = el.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`);
        if (!n) return null;
        let left = 0;
        let top = 0;
        for (let p: HTMLElement | null = n; p && p !== el; p = p.offsetParent as HTMLElement | null) {
          left += p.offsetLeft;
          top += p.offsetTop;
        }
        return { left, top, right: left + n.offsetWidth, height: n.offsetHeight };
      };
      const out: Line[] = [];
      columns.forEach((col, ci) => {
        const next = columns[ci + 1];
        if (!next) return;
        for (const a of col.nodes)
          for (const b of next.nodes) {
            const ra = rect(a.id);
            const rb = rect(b.id);
            if (!ra || !rb) continue;
            const x1 = ra.right;
            const y1 = ra.top + ra.height / 2;
            const x2 = rb.left - 6;
            const y2 = rb.top + rb.height / 2;
            const dx = Math.max(24, (x2 - x1) / 2);
            out.push({ d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, color: b.color, i: ci });
          }
      });
      setSize({ w: el.scrollWidth, h: el.scrollHeight });
      setLines(out);
    };
    const ro = new ResizeObserver(draw); // also fires once right away
    ro.observe(el);
    el.querySelectorAll("[data-node]").forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  }, [columns]);

  return (
    <div className="fd-scroll">
      <div ref={box} className="fd" role="img" aria-label={ariaLabel}>
        <svg className="fd-lines" width={size.w} height={size.h} aria-hidden>
          <defs>
            <marker id="fd-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#6366f1" />
            </marker>
          </defs>
          {lines.map((l, i) => (
            <path key={i} d={l.d} pathLength={1} className="fd-line" markerEnd="url(#fd-arrow)" style={{ animationDelay: `${0.25 + l.i * 0.12}s` }} />
          ))}
        </svg>
        {columns.map((col, ci) => (
          <div key={col.key} className="fd-col" style={{ "--ci": ci } as React.CSSProperties}>
            {col.label && (
              <p className="fd-col-head">
                <b>{col.label}</b>
                {col.sub && <span>{col.sub}</span>}
              </p>
            )}
            <div className="fd-nodes">
              {col.nodes.map((n, ni) => (
                <div key={n.id} data-node={n.id} className={`fd-node ${n.muted ? "is-muted" : ""}`} style={{ "--c": n.color, "--ni": ni } as React.CSSProperties}>
                  {n.icon && <span className="fd-icon">{n.icon}</span>}
                  <div className="min-w-0 flex-1">
                    <p className="fd-title">{n.title}</p>
                    {n.sub && <p className="fd-sub">{n.sub}</p>}
                    {n.meta && <div className="fd-meta">{n.meta}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
