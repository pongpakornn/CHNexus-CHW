import Link from "next/link";
import { PageBody, PageHeader } from "@/components/layout/Page";

// 🗂 PC DIGITAL WORKSPACE: system cards (same card look as the Systems launcher) · new PC system = add a card here
const CARDS = [{ href: "/pc/wof", name: "Work Order Follow", sub: "Monthly Part Production Follow", art: "/images/systems/work-order-follow.webp", color: "#4f46e5" }];

export default function Page() {
  return (
    <PageBody>
      <PageHeader icon="/icons/ForecastOrder.png" title="PC DIGITAL WORKSPACE" subtitle="Production Planning & TPS · เลือกระบบที่ต้องการใช้งาน" />
      <div className="sys-grid" style={{ marginTop: 0 }}>
        {CARDS.map((c, i) => (
          <Link key={c.href} href={c.href} className="sys-card" style={{ "--i": i, "--c": c.color, animationDelay: `${i * 0.08}s` } as React.CSSProperties}>
            <span className="sys-art" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.art} alt="" />
            </span>
            <span className="sys-tx">
              <b>{c.name}</b>
              <span>{c.sub}</span>
            </span>
            <span className="sys-go" aria-hidden>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </Link>
        ))}
      </div>
    </PageBody>
  );
}
