// 🖼 ภาพ Coil ตัวอย่าง (ใช้เมื่อสินค้ายังไม่มีรูปในระบบ) - วาดแบบการ์ตูนโทนเดียวกับโมเดล 3D:
//   ม้วนเหล็กวางนอนบนไม้คั่น มองเฉียงเห็นหน้าม้วน + รู + สายรัด + ป้ายกระดาษ · สีในตัวภาพ ใช้ได้ทั้งโหมดสว่าง / มืด
const INK = "#0a1630";
const ring = (k: number) => `<ellipse cx="96" cy="84" rx="${(58 * k).toFixed(1)}" ry="${(66 * k).toFixed(1)}" fill="none" stroke="#8090a8" stroke-width="2"/>`;
const strap = (x: number) => `<path d="M${x} 18A58 66 0 0 1 ${x} 150" fill="none" stroke="#46536b" stroke-width="6"/>`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 180">
<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#d9e1eb"/><stop offset=".24" stop-color="#d9e1eb"/>
<stop offset=".24" stop-color="#aebbcb"/><stop offset=".68" stop-color="#aebbcb"/>
<stop offset=".68" stop-color="#7d8ba3"/><stop offset="1" stop-color="#7d8ba3"/>
</linearGradient></defs>
<ellipse cx="134" cy="160" rx="112" ry="12" fill="${INK}" opacity=".3"/>
<path d="M10 160l34-26h22v26z" fill="#cfa567" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
<path d="M250 160l-34-26h-22v26z" fill="#b98d4f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
<path d="M96 18H170A58 66 0 0 1 170 150H96z" fill="url(#b)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
${strap(124)}${strap(150)}
<path d="M182 46l22 14v18l-22-10z" fill="#f6f8fb" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
<path d="M187 57l12 7M187 64l12 7" stroke="#8090a8" stroke-width="1.6"/>
<ellipse cx="96" cy="84" rx="58" ry="66" fill="#b9c5d4" stroke="${INK}" stroke-width="4"/>
<ellipse cx="96" cy="84" rx="53" ry="61" fill="none" stroke="#e9eef5" stroke-width="4"/>
${[0.82, 0.72, 0.62, 0.52].map(ring).join("")}
<path d="M112 66l30-27M80 102l-30 27" stroke="#46536b" stroke-width="6" stroke-linecap="round"/>
<ellipse cx="96" cy="84" rx="22" ry="25" fill="#66748d" stroke="${INK}" stroke-width="3"/>
<ellipse cx="101" cy="84" rx="15" ry="19" fill="#1c2740"/>
</svg>`;

export const COIL_ART = "data:image/svg+xml;utf8," + encodeURIComponent(SVG);
