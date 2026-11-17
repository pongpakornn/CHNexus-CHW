import Link from "next/link";
import { PageBody } from "@/components/layout/Page";

// 🗂 PC DIGITAL WORKSPACE: hero exactly like the main Systems page (title word-by-word, stamping-cell art, light sweep) + system cards below
//   new PC system = add a card to CARDS
const CARDS = [{ href: "/pc/wof", name: "Work Order Follow", sub: "Monthly Part Production Follow", art: "/images/systems/work-order-follow.webp", color: "#4f46e5" }];
const TITLE = ["PC Digital", "Workspace"];

export default function Page() {
  let w = 0; // word index (stagger)
  return (
    <PageBody>
      <section className="sys-stage" data-reveal="own">
        <div className="sys-hero">
          <div className="sys-hero-tx">
            <small>CHR-NEXUS · PRODUCTION PLANNING & TPS</small>
            <h2>
              {TITLE.map((line) => (
                <span key={line} className="sys-line">
                  {line.split(" ").map((word) => (
                    <span key={word} className="sys-word" style={{ "--w": w++ } as React.CSSProperties}>
                      {word}
                    </span>
                  ))}
                </span>
              ))}
            </h2>
            <i aria-hidden />
            <p>เลือกระบบที่ต้องการใช้งาน</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sys-hero-art" src="/images/systems/stamping-cell-art.webp" alt="" width={972} height={941} />
        </div>

        <div className="sys-grid">
          {CARDS.map((c, i) => (
            <Link key={c.href} href={c.href} className="sys-card" style={{ "--i": i, "--c": c.color } as React.CSSProperties}>
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
      </section>
    </PageBody>
  );
}
