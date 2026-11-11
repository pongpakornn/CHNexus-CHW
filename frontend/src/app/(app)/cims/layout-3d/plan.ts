// 🗺 ผังคลัง STOCK MATERIAL สำหรับหน้า Layout 3D (อ่านจากผังกระดาษ 1016 x 484 px · ยังไม่ใช่ระยะจริงหน้างาน)
//   แก้ผัง = แก้ที่ไฟล์นี้ไฟล์เดียว: ย้าย / ขยายโซน = px · เพิ่ม Rack = racks · ชื่อโซนพื้นใน LAYOUT SETUP = match
//   โครง Rack 3 แถว (ตามที่หน้างานยืนยัน): แถวหลังวางพื้น · แถวกลางยกเป็นชั้น 2 (ใต้ชั้น 2 เว้นว่าง ไม่มีตำแหน่ง) · แถวหน้าวางพื้น
//   1 ตำแหน่ง Rack = 1 ม้วน · โซนพื้น (Incoming Area / พื้นที่วาง RACK) = ทั้งโซนนับเป็น 1 ตำแหน่ง
//   ทิศของม้วน (เหมือนกันทั้งคลัง): แกนม้วนขนานแนวยาว Rack / แนวแถว = หน้าม้วนหันไปทางหัว-ท้ายแถว ตามรูปหน้างาน
//   โซนพื้นไม่มีคาน Rack ใช้ไม้หมอน + ไม้คั่น (หันตามม้วน): พื้นที่วาง RACK = 2 แถวติดกัน · Incoming = 2 แถวคู่กัน เว้นว่าง แล้วแถวที่ 3 ข้างเครื่องตัดเหล็ก

export const PLAN_W = 1016;
export const PLAN_H = 484;
const S = 0.05; // 1 px ของผัง = 0.05 หน่วยในโมเดล
const X = (px: number) => (px - PLAN_W / 2) * S;
const Z = (py: number) => (py - 250) * S;

export const LVH = 1.75; // ความสูง 1 ชั้น
export const SD = 1.35; // ความลึกของ 1 แถว
export const RO = 0.62; // รัศมีนอกของ Coil (ม้วนใหญ่สุด)
export const RI = 0.27; // รัศมีรู
export const CW = 1.0; // ความกว้างม้วน
export const SADDLE = 0.36; // Rack: ครึ่งระยะห่างของรางรองม้วน 2 เส้น (ม้วนนั่งคร่อมราง)
export const RAIL_TOP = 0.15; // Rack: ความสูงหลังรางรองม้วนจากพื้นของชั้น
export const SKID = 0.12; // โซนพื้น: ความสูงไม้หมอนรองม้วน
export const FLOOR_PITCH = 1.75; // โซนพื้น: ระยะห่างม้วนในแถวเดียวกัน

export type ZoneKind = "rack" | "floor" | "scenery";
export type RackRow = { lv: string; y: number; dz: number; out: 1 | -1; name: string };
export type Rack = { x0: number; x1: number; zc: number; bw: number; bays: string[]; rows: RackRow[] };
export type Slot = { id: string; zoneId: string; row: RackRow; x: number; y0: number; z: number; bw: number; tag: number; tx: number; ty: number; tz: number };
export type Zone = {
  id: string;
  no?: number; // เลขโซนในผังกระดาษ
  name: string;
  tag3d?: string; // ชื่อสั้นบนป้ายในโมเดล
  short: string; // ชื่อบนแผนผังย่อ
  kind: ZoneKind;
  color: number;
  px: [number, number, number, number];
  cx: number;
  cz: number;
  w: number;
  d: number;
  height: number;
  labelY: number;
  racks: Rack[];
  slots: Slot[];
  cols: number; // โซนพื้น: จำนวนม้วนต่อแถวที่วาดได้
  rowZ: number[]; // โซนพื้น: ตำแหน่งของแต่ละแถว (ระยะจากกึ่งกลางโซน · ลบ = ฝั่งถนน)
  cap: number; // โซนพื้น: จำนวนม้วนสูงสุดที่วาด (เกินนี้แสดงเป็นตัวเลข)
  match: string[]; // โซนพื้น: คำในชื่อประเภท / ตำแหน่งของ LAYOUT SETUP ที่ถือว่าเป็นโซนนี้ (ตัวพิมพ์ใหญ่ ไม่มีเว้นวรรค / ขีด)
};

type RackDef = { x: [number, number]; z: number; levels: string[]; bays: string };
type ZoneDef = Pick<Zone, "id" | "name" | "short" | "kind" | "color" | "px"> & { no?: number; tag3d?: string; labelY?: number; racks?: RackDef[]; match?: string[]; floorRows?: number[] };

const DEFS: ZoneDef[] = [
  { id: "RACKAREA", no: 20, name: "พื้นที่วาง RACK", short: "20", kind: "floor", color: 0xb7cf86, px: [25, 60, 225, 145], match: ["RACKAREA", "AREARACK"], floorRows: [-0.7, 0.7] },
  { id: "INCOMING", no: 18, name: "Incoming Area", short: "18", kind: "floor", color: 0xc3d8ee, px: [18, 155, 220, 270], match: ["INCOMING"], floorRows: [-1.95, -0.55, 1.95] },
  { id: "CUT", no: 17, name: "เครื่องตัดเหล็ก", short: "17", kind: "scenery", color: 0x55b8d4, px: [20, 285, 190, 405], labelY: 3.3 },
  { id: "TABLE", no: 16, name: "โต๊ะวางงาน", short: "16", kind: "scenery", color: 0x7ccbe0, px: [92, 415, 187, 468], labelY: 1.9 },
  {
    id: "STORE", no: 21, name: "STORE MATERIAL", short: "21", kind: "rack", color: 0xf0a23c, px: [310, 62, 780, 162],
    racks: [
      { x: [322, 543], z: 112, levels: ["1"], bays: "ABCDEF" },
      { x: [543, 768], z: 112, levels: ["2", "3", "4"], bays: "ABCDEF" },
    ],
  },
  { id: "COIL57", name: "Rack วางเหล็ก Coil 5–7", tag3d: "Rack Coil 5–7", short: "5–7", kind: "rack", color: 0xe38ba1, px: [310, 176, 630, 276], racks: [{ x: [322, 617], z: 226, levels: ["5", "6", "7"], bays: "ABCDEFGH" }] },
  { id: "COIL810", name: "Rack วางเหล็ก Coil 8–10", tag3d: "Rack Coil 8–10", short: "8–10", kind: "rack", color: 0xb5a2e0, px: [456, 288, 560, 388], racks: [{ x: [470, 545], z: 338, levels: ["8", "9", "10"], bays: "AB" }] },
  { id: "PACK", no: 19, name: "เหล็กแพ็ค", short: "19", kind: "scenery", color: 0xf0da3e, px: [320, 295, 435, 395], labelY: 1.6 },
  { id: "PIPE", no: 23, name: "STORE ท่อ", short: "23", kind: "scenery", color: 0x5d9ee0, px: [785, 62, 1005, 385], labelY: 3.2 },
  { id: "PACKSHELF", no: 22, name: "ชั้นวางเหล็กแพ็ค", short: "22", kind: "scenery", color: 0x8dc45a, px: [728, 425, 1015, 470], labelY: 3.1 },
];

function build() {
  const zones: Zone[] = [];
  const slots: Slot[] = [];
  for (const def of DEFS) {
    const z: Zone = {
      id: def.id, no: def.no, name: def.name, tag3d: def.tag3d, short: def.short, kind: def.kind, color: def.color, px: def.px,
      cx: X((def.px[0] + def.px[2]) / 2), cz: Z((def.px[1] + def.px[3]) / 2), w: (def.px[2] - def.px[0]) * S, d: (def.px[3] - def.px[1]) * S,
      height: 2, labelY: def.labelY ?? 2.2, racks: [], slots: [], cols: 1, rowZ: def.floorRows ?? [0], cap: 0, match: def.match ?? [],
    };
    if (z.kind === "rack") {
      let top = 0;
      for (const rd of def.racks ?? []) {
        const x0 = X(rd.x[0]);
        const x1 = X(rd.x[1]);
        const bays = rd.bays.split("");
        // levels เรียงตามผังกระดาษ [แถวบนของผัง, แถวกลาง, แถวล่างของผัง] = [พื้น-หลัง, ชั้น 2-กลาง, พื้น-หน้า]
        const rows: RackRow[] =
          rd.levels.length === 3
            ? [
                { lv: rd.levels[0], y: 0, dz: -SD, out: -1, name: "วางพื้น แถวหลัง" },
                { lv: rd.levels[1], y: LVH, dz: 0, out: 1, name: "ชั้น 2 ตรงกลาง (ใต้ชั้นเว้นว่าง)" },
                { lv: rd.levels[2], y: 0, dz: SD, out: 1, name: "วางพื้น แถวหน้า" },
              ]
            : [{ lv: rd.levels[0], y: 0, dz: 0, out: 1, name: "วางพื้น แถวเดียว" }];
        const rack: Rack = { x0, x1, zc: Z(rd.z), bw: (x1 - x0) / bays.length, bays, rows };
        for (const row of rows) {
          top = Math.max(top, row.y + LVH);
          bays.forEach((b, bi) => {
            const x = x0 + (bi + 0.5) * rack.bw;
            const zz = rack.zc + row.dz;
            const s: Slot = { id: row.lv + b, zoneId: z.id, row, x, y0: row.y, z: zz, bw: rack.bw, tag: slots.length, tx: x, ty: row.y + 0.2, tz: zz + row.out * (SD / 2 + 0.12) };
            slots.push(s);
            z.slots.push(s);
          });
        }
        z.racks.push(rack);
      }
      z.height = top + 0.3;
    } else if (z.kind === "floor") {
      z.cols = Math.max(1, Math.floor((z.w - 1) / FLOOR_PITCH));
      z.cap = z.cols * z.rowZ.length;
    }
    zones.push(z);
  }
  return { zones, slots };
}

const built = build();
export const ZONES = built.zones;
export const SLOTS = built.slots;
export const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));
export const SLOT_BY_ID = new Map(SLOTS.map((s) => [s.id, s]));

// ตำแหน่งม้วนที่ i ของโซนพื้น (เรียงซ้ายไปขวา แถวฝั่งถนนก่อน) -> [x, ความสูงหลังไม้หมอน, z]
export function floorPos(z: Zone, i: number): [number, number, number] {
  const c = i % z.cols;
  const r = Math.floor(i / z.cols) % z.rowZ.length;
  return [z.cx - ((z.cols - 1) / 2) * FLOOR_PITCH + c * FLOOR_PITCH, SKID, z.cz + z.rowZ[r]];
}

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const SLOT_TAIL = /(?:^|[^0-9])(\d{1,2}[A-Z])$/;

function slotOf(c: string): string | null {
  if (!c) return null;
  if (SLOT_BY_ID.has(c)) return c;
  const m = SLOT_TAIL.exec(c);
  return m && SLOT_BY_ID.has(m[1]) ? m[1] : null;
}

export type Place = { slotId: string } | { zoneId: string };

/**
 * ตำแหน่งใน LAYOUT SETUP / ข้อความที่สแกน -> ตำแหน่งในโมเดล
 *   Rack: ชื่อตำแหน่งตรงกับรหัสช่องในผัง (6A) · หรือ ประเภท + ชื่อ ลงท้ายด้วยรหัสช่อง (RACK6 + A) · หรือคำสุดท้ายของข้อความที่สแกน
 *   โซนพื้น: ชื่อประเภท / ตำแหน่ง มีคำใน match ของโซน (INCOMING, RACKAREA)
 */
export function locate(typeName: string | null | undefined, locName: string | null | undefined, text?: string | null): Place | null {
  const t = norm(typeName);
  const n = norm(locName);
  const words = (text ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const cands = [n, t && n ? t + n : "", words[words.length - 1] ?? "", words.join("")];
  for (const c of cands) {
    const id = slotOf(c);
    if (id) return { slotId: id };
  }
  for (const z of ZONES) if (z.kind === "floor" && [t, n, t + n, words.join("")].some((c) => c && z.match.some((k) => c.includes(k)))) return { zoneId: z.id };
  return null;
}
