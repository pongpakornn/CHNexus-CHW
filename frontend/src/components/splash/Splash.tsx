import "./splash.css";
import { SPLASH_SCRIPT } from "./splashScript";

// 🚀 Splash Screen ตอนเปิดเว็บ (วางเป็นลูกตัวแรกของ <body> ใน app/layout.tsx)
//   Server Component: markup มากับ HTML เลย -> เห็นทันที ก่อน JS ของ Next โหลด
//   สคริปต์แก้ class ของกล่องนี้ก่อน React เริ่ม = suppressHydrationWarning (React ไม่แตะกล่องนี้อีก)
const TITLE = "CHR-Nexus";
const SUB = "CH.RADIATORS COMPANY LIMITED";

export function Splash() {
  return (
    <>
      <div id="chr-splash" aria-hidden suppressHydrationWarning>
        <div className="cs-center">
          <div className="cs-logo-wrap">
            <div className="cs-ring cs-ring-2" />
            <div className="cs-ring cs-ring-1" />
            <div className="cs-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/app-192.png" alt="" />
            </div>
          </div>
          <div className="cs-title">
            {TITLE.split("").map((ch, i) => (
              <span key={i} style={{ animationDelay: `${350 + i * 70}ms` }}>
                {ch}
              </span>
            ))}
          </div>
          <div className="cs-sub">{SUB}</div>
          <div className="cs-bar">
            <i id="cs-fill" suppressHydrationWarning />
          </div>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: SPLASH_SCRIPT }} />
    </>
  );
}
