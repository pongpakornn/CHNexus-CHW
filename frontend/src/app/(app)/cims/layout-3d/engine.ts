// 🎬 ตัววาดโมเดล 3D ของหน้า Layout 3D (three.js ล้วน ไม่ผูกกับ React)
//   เบาเครื่อง: ของที่ซ้ำกันใช้ InstancedMesh (Coil ทั้งคลัง = 1 draw call) · ไม่มีเงา / post-process · ป้ายตำแหน่งรวมเป็น texture เดียว
//   วาดเฉพาะตอนมีการขยับ (กล้อง / แอนิเมชันสแกนเข้า-ออก) ภาพนิ่ง = หยุดวาด · เครื่องช้า = ลดความละเอียดเอง
//   สีใช้ค่าตรง ๆ (ปิด ColorManagement) ให้ได้โทนการ์ตูนตามที่อนุมัติใน Preview
import * as THREE from "three";
import { CW, LVH, RI, RO, SD, SLOTS, SLOT_BY_ID, ZONES, ZONE_BY_ID, floorPos, type Slot, type Zone } from "./plan";

export type Sel = { kind: "slot"; slotId: string } | { kind: "floor"; zoneId: string; coilId: number } | null;
export type Hit = { kind: "slot"; slotId: string; zoneId: string } | { kind: "floor"; zoneId: string; coilId: number } | { kind: "zone"; zoneId: string };
export type EngineData = {
  slots: Record<string, number>; // รหัสช่อง -> CoilID ที่แสดง (ไม่มี = ว่าง)
  floors: Record<string, number[]>; // โซนพื้น -> CoilID เรียงตามลำดับที่วาง
  labels: Record<string, string>; // โซน -> ข้อความจำนวนบนป้าย (เช่น 17/24)
};
export type Handlers = {
  onPick: (hit: Hit) => void;
  onHover: (hit: Hit | null, x: number, y: number) => void;
  onPerf?: (text: string) => void;
};
export type Engine = {
  setData: (d: EngineData) => void;
  setFocus: (zoneId: string | null) => void;
  setSelection: (sel: Sel) => void;
  zoom: (factor: number) => void;
  rotate: () => void;
  dispose: () => void;
};

type BoxItem = [number, number, number, number, number, number, number];
type CoilState = { id: number; t0: number; tone: number };
type Leaving = { pos: [number, number, number]; zoneId: string; tone: number; t0: number };
type FloorPick = { zoneId: string; coilId: number; box: THREE.Box3 };

const FLOOR = 0x143f86;
const GREEN = 0x2e9f6b;
const GREEN_D = 0x237f55;
const YELLOW = 0xf6b02c;
const FOV = 32;
const TANV = Math.tan((FOV * Math.PI) / 360);
const ACOLS = 8;
const CELL_W = 128;
const CELL_H = 64;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const toneOf = (id: number) => 0.9 + ((Math.imul(id, 2654435761) >>> 0) % 100) / 1000;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOutBack = (p: number) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);

function mergeGeos(list: THREE.BufferGeometry[]) {
  let nV = 0;
  let nI = 0;
  for (const g of list) {
    nV += g.attributes.position.count;
    nI += g.index!.count;
  }
  const pos = new Float32Array(nV * 3);
  const nor = new Float32Array(nV * 3);
  const uv = new Float32Array(nV * 2);
  const idx = new Uint16Array(nI);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const ia = g.index!.array;
    for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
    vo += g.attributes.position.count;
    io += ia.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function fillUV(g: THREE.BufferGeometry, u: number, v: number) {
  const a = g.attributes.uv.array as Float32Array;
  for (let i = 0; i < a.length; i += 2) {
    a[i] = u;
    a[i + 1] = v;
  }
}

function roundRect(g: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(l + r, t);
  g.arcTo(l + w, t, l + w, t + h, r);
  g.arcTo(l + w, t + h, l, t + h, r);
  g.arcTo(l, t + h, l, t, r);
  g.arcTo(l, t, l + w, t, r);
  g.closePath();
}

export function createEngine(canvas: HTMLCanvasElement, stage: HTMLElement, handlers: Handlers): Engine | null {
  THREE.ColorManagement.enabled = false;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
  } catch {
    return null;
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const fontFamily = getComputedStyle(document.body).fontFamily || "sans-serif";
  const trash: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(o: T) => {
    trash.push(o);
    return o;
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x081428);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 400);
  scene.add(new THREE.HemisphereLight(0xe6efff, 0x20356a, 0.6 * Math.PI));
  const sun = new THREE.DirectionalLight(0xffffff, 0.5 * Math.PI);
  sun.position.set(8, 20, 14);
  scene.add(sun);

  const grad = keep(new THREE.DataTexture(new Uint8Array([105, 165, 225, 255]), 4, 1, THREE.RedFormat));
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.needsUpdate = true;

  /* ---------- กล่อง instanced: พื้น / โครง Rack / ฉากประกอบ ---------- */
  const boxGeo = keep(new THREE.BoxGeometry(1, 1, 1));
  const flatMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const litMat = keep(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: grad }));
  function buildBatch(items: BoxItem[], material: THREE.Material, geo: THREE.BufferGeometry = boxGeo) {
    const mesh = new THREE.InstancedMesh(geo, material, items.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      m.compose(new THREE.Vector3(it[0], it[1], it[2]), q, new THREE.Vector3(it[3], it[4], it[5]));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setHex(it[6]));
    });
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }
  const tone = (hex: number, k: number) => new THREE.Color(hex).lerp(new THREE.Color(FLOOR), k).getHex();

  const flat: BoxItem[] = [];
  flat.push([0, -0.25, -0.3, 53.4, 0.5, 26.2, FLOOR]); // พื้นอาคาร
  flat.push([0, 0.01, -11.75, 53.4, 0.04, 3.1, 0x1d58b0]); // ถนนทางเดิน
  flat.push([0, 0.04, -10.15, 53.4, 0.05, 0.12, 0xdc5a52]);
  for (let x = -24; x <= 24; x += 4) flat.push([x, 0.04, -11.9, 1.8, 0.03, 0.12, 0xdfe9ff]);
  for (const z of ZONES) {
    flat.push([z.cx, 0.04, z.cz, z.w, 0.06, z.d, tone(z.color, z.kind === "scenery" ? 0.45 : 0.22)]);
    if (z.kind === "scenery") continue;
    const t = 0.1;
    const y = 0.09; // เส้นตีกรอบเหลืองของโซนเก็บเหล็ก
    flat.push([z.cx, y, z.cz - z.d / 2, z.w + t, 0.04, t, YELLOW], [z.cx, y, z.cz + z.d / 2, z.w + t, 0.04, t, YELLOW]);
    flat.push([z.cx - z.w / 2, y, z.cz, t, 0.04, z.d, YELLOW], [z.cx + z.w / 2, y, z.cz, t, 0.04, z.d, YELLOW]);
  }
  buildBatch(flat, flatMat);

  // โครง Rack สีเขียว: 1 mesh ต่อโซน (เข้าโซน = แสดงโซนนั้นเดี่ยว ๆ)
  const rackMesh = new Map<string, THREE.InstancedMesh>();
  for (const z of ZONES) {
    if (z.kind !== "rack") continue;
    const items: BoxItem[] = [];
    for (const r of z.racks) {
      const n = r.bays.length;
      const w = r.x1 - r.x0;
      const xm = (r.x0 + r.x1) / 2;
      const rail = (y: number, dz: number) => items.push([xm, y, r.zc + dz, w + 0.13, 0.13, 0.1, GREEN]);
      if (r.rows.length === 1) {
        // แถวเดียววางพื้น: เสาเตี้ย + ราวกัน
        for (let b = 0; b <= n; b++) for (const sd of [-1, 1]) items.push([r.x0 + b * r.bw, 0.55, r.zc + (sd * SD) / 2, 0.13, 1.1, 0.13, GREEN]);
        for (const sd of [-1, 1]) {
          rail(0.07, (sd * SD) / 2);
          rail(1.03, (sd * SD) / 2);
        }
        continue;
      }
      // 3 แถวตามผัง: หลัง (พื้น) / กลาง (ชั้น 2 ใต้ชั้นเว้นว่าง) / หน้า (พื้น)
      const deck = LVH + 0.07;
      const top = 2 * LVH + 0.2;
      for (let b = 0; b <= n; b++) {
        const x = r.x0 + b * r.bw;
        for (const sd of [-1, 1]) {
          items.push([x, top / 2, r.zc + (sd * SD) / 2, 0.13, top, 0.13, GREEN]); // เสากลาง: พื้นถึงราวบน รับชั้น 2
          items.push([x, 0.55, r.zc + sd * SD * 1.5, 0.13, 1.1, 0.13, GREEN]); // เสาเตี้ยริมนอกของแถวพื้น
        }
        items.push([x, deck, r.zc, 0.11, 0.13, SD + 0.13, GREEN]); // คานขวางรับชั้น 2
      }
      for (const sd of [-1, 1]) {
        rail(0.07, (sd * SD) / 2);
        rail(deck, (sd * SD) / 2);
        rail(top, (sd * SD) / 2);
        rail(0.07, sd * SD * 1.5);
        rail(1.03, sd * SD * 1.5);
      }
    }
    for (const s of z.slots) for (const dx of [-0.4, 0.4]) items.push([s.x + dx, s.y0 + 0.1, s.z, 0.1, 0.1, SD - 0.12, GREEN_D]); // ไม้รองม้วน
    rackMesh.set(z.id, buildBatch(items, litMat));
  }

  // ฉากประกอบ (กดไม่ได้): เครื่องตัดเหล็ก / โต๊ะวางงาน / เหล็กแพ็ค / STORE ท่อ / ชั้นวางเหล็กแพ็ค
  const lit: BoxItem[] = [];
  const pipeItems: BoxItem[] = [];
  {
    let z = ZONE_BY_ID.get("CUT")!;
    lit.push([z.cx - 0.4, 0.45, z.cz, 6.2, 0.9, 2.6, 0x2f8fb0], [z.cx - 1.6, 1.55, z.cz, 2.6, 1.3, 2.2, 0x49b5d6], [z.cx - 1.6, 2.4, z.cz, 2.0, 0.4, 1.6, 0x2f8fb0]);
    lit.push([z.cx + 1.5, 1.0, z.cz, 2.4, 0.2, 2.0, 0xa7b6c8], [z.cx - 3.2, 0.9, z.cz + 2.0, 0.6, 1.8, 0.5, YELLOW], [z.cx + 3.3, 0.25, z.cz - 1.4, 1.6, 0.5, 2.0, 0xb9c4d2]);

    z = ZONE_BY_ID.get("TABLE")!;
    lit.push([z.cx, 0.9, z.cz, 3.6, 0.14, 1.8, 0xd9b382]);
    for (const [dx, dz] of [[-1.6, -0.75], [1.6, -0.75], [-1.6, 0.75], [1.6, 0.75]]) lit.push([z.cx + dx, 0.42, z.cz + dz, 0.14, 0.84, 0.14, 0x7a8aa6]);

    z = ZONE_BY_ID.get("PACK")!;
    const r2 = mulberry32(19);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const px = z.cx + (i - 1) * 1.9;
        const pz = z.cz + (j - 1) * 1.62;
        const layers = 1 + Math.floor(r2() * 4);
        lit.push([px, 0.13, pz, 1.6, 0.12, 1.3, 0xc49a5a]);
        for (let k = 0; k < layers; k++) lit.push([px, 0.31 + k * 0.24, pz, 1.5, 0.22, 1.22, k % 2 ? 0xa3afc0 : 0xc1cbd8]);
      }

    z = ZONE_BY_ID.get("PIPE")!;
    const r3 = mulberry32(23);
    for (const py of [92, 156, 220, 285, 352]) {
      const rz = (py - 250) * 0.05;
      for (const dx of [-3.6, 0, 3.6]) {
        const x = z.cx + dx;
        lit.push([x, 1.15, rz, 0.18, 2.3, 0.18, 0x3d7fd0], [x, 0.07, rz, 0.3, 0.14, 2.0, 0x2f66ad], [x, 0.95, rz, 0.14, 0.12, 1.9, 0x3d7fd0], [x, 1.85, rz, 0.14, 0.12, 1.9, 0x3d7fd0]);
      }
      for (const ay of [0.95, 1.85])
        for (const dz of [-0.72, -0.36, 0.36, 0.72]) {
          if (r3() < 0.2) continue;
          pipeItems.push([z.cx, ay + 0.22, rz + dz, 9.0 + r3() * 0.6, 1, 1, r3() < 0.25 ? 0xcf8246 : r3() < 0.5 ? 0xaab5c4 : 0xc3ccd8]);
        }
    }

    z = ZONE_BY_ID.get("PACKSHELF")!;
    const r4 = mulberry32(22);
    for (let sx = -6.6; sx <= 6.61; sx += 3.3) for (const dz of [-0.8, 0.8]) lit.push([z.cx + sx, 1.2, z.cz + dz, 0.14, 2.4, 0.14, 0x6aa84f]);
    for (const sy of [0.18, 1.3]) {
      lit.push([z.cx, sy, z.cz, 13.4, 0.1, 1.8, 0x5c9644]);
      for (let bx = -5.0; bx <= 5.01; bx += 3.3) {
        const hh = 0.3 + r4() * 0.5;
        lit.push([z.cx + bx, sy + 0.05 + hh / 2, z.cz, 2.2, hh, 1.3, r4() < 0.5 ? 0xb9c4d2 : 0xa3afc0]);
      }
    }
  }
  const sceneryMesh = buildBatch(lit, litMat);
  const pipeGeo = keep(new THREE.CylinderGeometry(0.15, 0.15, 1, 8));
  pipeGeo.rotateZ(Math.PI / 2);
  const pipesMesh = buildBatch(pipeItems, litMat, pipeGeo);

  /* ---------- Coil: เรขาคณิตเดียวใช้ซ้ำทุกม้วน + เส้นขอบการ์ตูน ---------- */
  const coilGeo = keep(
    (() => {
      const outer = new THREE.CylinderGeometry(RO, RO, CW, 28, 1, true);
      outer.rotateX(Math.PI / 2);
      fillUV(outer, 0.5, 0.5);
      const inner = new THREE.CylinderGeometry(RI, RI, CW, 18, 1, true);
      inner.rotateX(Math.PI / 2);
      fillUV(inner, 0.03, 0.03);
      const n = inner.attributes.normal.array as Float32Array;
      for (let i = 0; i < n.length; i++) n[i] = -n[i];
      const ia = inner.index!.array as Uint16Array;
      for (let i = 0; i < ia.length; i += 3) {
        const t = ia[i + 1];
        ia[i + 1] = ia[i + 2];
        ia[i + 2] = t;
      }
      const f1 = new THREE.RingGeometry(RI, RO, 28, 1);
      f1.translate(0, 0, CW / 2);
      const f2 = new THREE.RingGeometry(RI, RO, 28, 1);
      f2.rotateY(Math.PI);
      f2.translate(0, 0, -CW / 2);
      return mergeGeos([outer, inner, f1, f2]);
    })(),
  );
  const coilTex = keep(
    (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d")!;
      g.fillStyle = "#56637c"; // ผิวรูด้านใน
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = "#b7c3d3"; // หน้าม้วน
      g.beginPath();
      g.arc(64, 64, 64, 0, 7);
      g.fill();
      g.strokeStyle = "#7f90a9";
      g.lineWidth = 2;
      for (let r = 31; r < 60; r += 5) {
        g.beginPath();
        g.arc(64, 64, r, 0, 7);
        g.stroke();
      }
      g.lineWidth = 4;
      g.strokeStyle = "#eef3f9";
      g.beginPath();
      g.arc(64, 64, 61, 0, 7);
      g.stroke();
      g.strokeStyle = "#6d7b93";
      g.beginPath();
      g.arc(64, 64, 27, 0, 7);
      g.stroke();
      g.save();
      g.translate(64, 64);
      g.fillStyle = "#4d5a72"; // สายรัด
      for (const a of [0.9, 3.5]) {
        g.save();
        g.rotate(a);
        g.fillRect(24, -2.5, 40, 5);
        g.restore();
      }
      g.restore();
      g.fillStyle = "#c4cfdc"; // ผิวโค้งด้านนอก (uv จุดกลาง)
      g.beginPath();
      g.arc(64, 64, 20, 0, 7);
      g.fill();
      return new THREE.CanvasTexture(c);
    })(),
  );
  const MAXC = SLOTS.length + ZONES.reduce((a, z) => a + z.cap, 0) + 16;
  const coilMesh = new THREE.InstancedMesh(coilGeo, keep(new THREE.MeshToonMaterial({ color: 0xffffff, map: coilTex, gradientMap: grad })), MAXC);
  const outGeo = keep(new THREE.CylinderGeometry(RO + 0.045, RO + 0.045, CW + 0.09, 24));
  outGeo.rotateX(Math.PI / 2);
  const outMesh = new THREE.InstancedMesh(outGeo, keep(new THREE.MeshBasicMaterial({ color: 0x0a1630, side: THREE.BackSide })), MAXC);
  outMesh.instanceMatrix = coilMesh.instanceMatrix;
  coilMesh.frustumCulled = outMesh.frustumCulled = false;
  {
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < MAXC; i++) coilMesh.setColorAt(i, c);
  }
  coilMesh.count = outMesh.count = 0;
  scene.add(outMesh, coilMesh);

  /* ---------- ป้ายตำแหน่ง: atlas เดียว + หันเข้ากล้องใน shader (1 draw call ทั้งคลัง) ---------- */
  const slotCoil = new Map<string, CoilState>();
  const atlas = document.createElement("canvas");
  atlas.width = 1024;
  atlas.height = 512;
  const actx = atlas.getContext("2d")!;
  const atlasTex = keep(new THREE.CanvasTexture(atlas));
  function drawTag(s: Slot) {
    const x = (s.tag % ACOLS) * CELL_W;
    const y = Math.floor(s.tag / ACOLS) * CELL_H;
    const on = slotCoil.has(s.id);
    actx.clearRect(x, y, CELL_W, CELL_H);
    actx.fillStyle = on ? "#3ad685" : "#2a3d66";
    actx.strokeStyle = on ? "#0b3b24" : "#56698f";
    actx.lineWidth = 4;
    roundRect(actx, x + 8, y + 6, CELL_W - 16, CELL_H - 12, 12);
    actx.fill();
    actx.stroke();
    actx.fillStyle = on ? "#052616" : "#a9b9d9";
    actx.font = `800 38px ${fontFamily}`;
    actx.textAlign = "center";
    actx.textBaseline = "middle";
    actx.fillText(s.id, x + CELL_W / 2, y + CELL_H / 2 + 2);
  }
  const tagGeo = keep(new THREE.PlaneGeometry(1, 1));
  {
    const off = new Float32Array(SLOTS.length * 2);
    SLOTS.forEach((s, i) => {
      off[i * 2] = (s.tag % ACOLS) / ACOLS;
      off[i * 2 + 1] = 1 - (Math.floor(s.tag / ACOLS) + 1) / 8;
    });
    tagGeo.setAttribute("uvOffset", new THREE.InstancedBufferAttribute(off, 2));
  }
  const tagMat = keep(
    new THREE.ShaderMaterial({
      uniforms: { map: { value: atlasTex }, size: { value: new THREE.Vector2(0.7, 0.35) }, cell: { value: new THREE.Vector2(1 / ACOLS, 1 / 8) } },
      vertexShader:
        "attribute vec2 uvOffset; uniform vec2 size; uniform vec2 cell; varying vec2 vUv;" +
        "void main(){ vUv = uv * cell + uvOffset; vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);" +
        " mv.xy += position.xy * size * max(1.0, -mv.z / 30.0); gl_Position = projectionMatrix * mv; }",
      fragmentShader: "uniform sampler2D map; varying vec2 vUv; void main(){ vec4 c = texture2D(map, vUv); if (c.a < 0.5) discard; gl_FragColor = vec4(c.rgb, 1.0); }",
    }),
  );
  const tagMesh = new THREE.InstancedMesh(tagGeo, tagMat, SLOTS.length);
  tagMesh.frustumCulled = false;
  scene.add(tagMesh);

  /* ---------- ป้ายชื่อโซน (Sprite ขนาดคงที่บนจอ) ---------- */
  type Label = { sprite: THREE.Sprite; canvas: HTMLCanvasElement; ratio: number; text: string; stock: boolean };
  const labels = new Map<string, Label>();
  const labelText: Record<string, string> = {};
  function drawLabel(id: string, name: string, no: number | undefined, stock: boolean, pos: [number, number, number]) {
    let lb = labels.get(id);
    const cnt = labelText[id] ?? "";
    const key = name + "|" + cnt;
    if (lb && lb.text === key) return;
    const c = lb?.canvas ?? document.createElement("canvas");
    let g = c.getContext("2d")!;
    const font = `700 40px ${fontFamily}`;
    g.font = font;
    const tw = g.measureText(name).width;
    const cw = cnt ? g.measureText(cnt).width + 26 : 0;
    const bw = no ? 78 : 0;
    c.width = Math.ceil(tw + cw + bw + 56);
    c.height = 88;
    g = c.getContext("2d")!;
    g.fillStyle = "rgba(8,20,40,0.82)";
    g.strokeStyle = stock ? "#f6b02c" : "#3a5488";
    g.lineWidth = 3;
    roundRect(g, 2, 2, c.width - 4, c.height - 4, 22);
    g.fill();
    g.stroke();
    let x = 26;
    g.textBaseline = "middle";
    if (no) {
      g.fillStyle = "#f6b02c";
      g.beginPath();
      g.arc(x + 26, 44, 28, 0, 7);
      g.fill();
      g.fillStyle = "#1a1300";
      g.textAlign = "center";
      g.font = `800 34px ${fontFamily}`;
      g.fillText(String(no), x + 26, 46);
      x += bw;
    }
    g.font = font;
    g.textAlign = "left";
    g.fillStyle = stock ? "#ffffff" : "#b9c8e6";
    g.fillText(name, x, 46);
    x += tw + 26;
    if (cnt) {
      g.fillStyle = "#3ad685";
      g.fillText(cnt, x, 46);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    if (!lb) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true }));
      sprite.center.set(0.5, 0);
      sprite.renderOrder = 10;
      sprite.position.set(pos[0], pos[1], pos[2]);
      scene.add(sprite);
      lb = { sprite, canvas: c, ratio: 1, text: key, stock };
      labels.set(id, lb);
    } else {
      lb.sprite.material.map?.dispose();
      lb.sprite.material.map = tex;
      lb.text = key;
    }
    lb.ratio = c.width / c.height;
  }
  function drawLabels() {
    for (const z of ZONES) drawLabel(z.id, z.tag3d ?? z.name, z.no, z.kind !== "scenery", [z.cx, z.kind === "rack" ? z.height + 0.7 : z.labelY, z.kind === "rack" ? z.racks[0].zc : z.cz]);
    drawLabel("ROAD", "ถนนทางเดิน", undefined, false, [-17, 0.3, -11.8]);
    sizeLabels();
  }
  function sizeLabels() {
    const hpx = stage.clientHeight || 600;
    const sy = ((stage.clientWidth < 520 ? 22 : 28) * 2 * TANV) / hpx;
    for (const lb of labels.values()) lb.sprite.scale.set(sy * lb.ratio, sy, 1);
    showLabels();
  }
  // เข้าโซน = เหลือป้ายของโซนนั้น · จอแคบ (มือถือ) ในภาพรวม = ซ่อนป้ายฉากประกอบ ไม่ให้ป้ายบังโมเดล
  function showLabels() {
    const narrow = stage.clientWidth < 520;
    for (const [id, lb] of labels) lb.sprite.visible = focus ? focus.id === id : lb.stock || !narrow;
  }

  /* ---------- กรอบเลือก / กรอบชี้ ---------- */
  const edgeGeo = keep(new THREE.EdgesGeometry(boxGeo));
  const selBox = new THREE.Group();
  selBox.add(new THREE.Mesh(boxGeo, keep(new THREE.MeshBasicMaterial({ color: 0xf6b02c, transparent: true, opacity: 0.16, depthWrite: false }))));
  selBox.add(new THREE.LineSegments(edgeGeo, keep(new THREE.LineBasicMaterial({ color: 0xffc64d }))));
  const hovBox = new THREE.LineSegments(edgeGeo, keep(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })));
  selBox.visible = hovBox.visible = false;
  scene.add(selBox, hovBox);
  const fitBox = (obj: THREE.Object3D, box: THREE.Box3) => {
    box.getCenter(obj.position);
    box.getSize(obj.scale);
    obj.visible = true;
  };
  const slotBox = new Map<string, THREE.Box3>();
  for (const s of SLOTS) slotBox.set(s.id, new THREE.Box3(new THREE.Vector3(s.x - s.bw / 2, s.y0, s.z - SD / 2), new THREE.Vector3(s.x + s.bw / 2, s.y0 + LVH, s.z + SD / 2)));

  /* ---------- สถานะ ---------- */
  let focus: Zone | null = null;
  let sel: Sel = null;
  let hoverKey: string | null = null;
  let loaded = false;
  let disposed = false;
  const floorCoils = new Map<string, CoilState[]>();
  let leaving: Leaving[] = [];
  let floorPicks: FloorPick[] = [];

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _c = new THREE.Color();
  function syncCoils(t: number) {
    let i = 0;
    let busy = false;
    const put = (x: number, y: number, z: number, tn: number, t0: number, isSel: boolean, out: number | null) => {
      if (i >= MAXC) return;
      const p = reduceMotion ? 1 : Math.min(1, (t - t0) / 480);
      let sc = 1;
      let dy = 0;
      if (out !== null) {
        sc = Math.max(0.001, 1 - out);
        busy = true;
      } else if (p < 1) {
        dy = (1 - easeOutBack(p)) * 1.5;
        sc = 0.75 + 0.25 * p;
        busy = true;
      }
      if (isSel) sc *= 1.04;
      _p.set(x, y + dy, z);
      _s.set(sc, sc, sc);
      _m.compose(_p, _q, _s);
      coilMesh.setMatrixAt(i, _m);
      if (isSel) _c.setRGB(1, 0.8, 0.36);
      else _c.setRGB(tn, tn, Math.min(1, tn * 1.03));
      coilMesh.setColorAt(i, _c);
      i++;
    };
    for (const s of SLOTS) {
      const c = slotCoil.get(s.id);
      if (c && (!focus || s.zoneId === focus.id)) put(s.x, s.y0 + 0.14 + RO, s.z, c.tone, c.t0, sel?.kind === "slot" && sel.slotId === s.id, null);
    }
    floorPicks = [];
    for (const z of ZONES) {
      if (z.kind !== "floor" || (focus && z !== focus)) continue;
      (floorCoils.get(z.id) ?? []).forEach((c, k) => {
        if (k >= z.cap) return;
        const [x, y, zz] = floorPos(z, k);
        put(x, y, zz, c.tone, c.t0, sel?.kind === "floor" && sel.coilId === c.id, null);
        floorPicks.push({ zoneId: z.id, coilId: c.id, box: new THREE.Box3(new THREE.Vector3(x - RO, 0, zz - CW / 2), new THREE.Vector3(x + RO, y + RO, zz + CW / 2)) });
      });
    }
    leaving = leaving.filter((l) => {
      const lp = reduceMotion ? 1 : (t - l.t0) / 260;
      if (lp >= 1) return false;
      if (!focus || l.zoneId === focus.id) put(l.pos[0], l.pos[1], l.pos[2], l.tone, 0, false, lp);
      else busy = true;
      return true;
    });
    coilMesh.count = outMesh.count = i;
    coilMesh.instanceMatrix.needsUpdate = true;
    if (coilMesh.instanceColor) coilMesh.instanceColor.needsUpdate = true;
    return busy;
  }
  function selBoxNow(): THREE.Box3 | null {
    if (!sel) return null;
    if (sel.kind === "slot") return slotBox.get(sel.slotId) ?? null;
    const id = sel.coilId;
    return floorPicks.find((f) => f.coilId === id)?.box ?? null;
  }
  function applyFocus() {
    sceneryMesh.visible = pipesMesh.visible = !focus;
    for (const [id, mesh] of rackMesh) mesh.visible = !focus || focus.id === id;
    showLabels();
    SLOTS.forEach((s, i) => {
      _m.makeTranslation(s.tx, !focus || s.zoneId === focus.id ? s.ty : -999, s.tz);
      tagMesh.setMatrixAt(i, _m);
    });
    tagMesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------- กล้อง: หมุน / ซูม / เลื่อน แบบหน่วงนุ่ม ---------- */
  const cur = { t: new THREE.Vector3(0, 0, 0.3), az: -0.38, pol: 0.86, dist: 80 };
  const goal = { t: new THREE.Vector3(0, 0, 0.3), az: -0.38, pol: 0.86, dist: 80 };
  let kSmooth = 5;
  let maxDist = 120;
  let userMoved = false;
  const aspect = () => (stage.clientWidth || 1) / (stage.clientHeight || 1);
  const overviewDist = () => Math.max(27.5 / (TANV * aspect()), 15 / TANV);
  const flyAz = (target: number) => {
    goal.az = target + Math.PI * 2 * Math.round((cur.az - target) / (Math.PI * 2));
  };
  function flyOverview() {
    goal.t.set(0, 0, 0.3);
    goal.pol = 0.86;
    goal.dist = overviewDist();
    flyAz(-0.38);
    kSmooth = 4.5;
    userMoved = false;
  }
  function flyZone(z: Zone) {
    const rack = z.kind === "rack";
    const hgt = rack ? z.height : z.d * 0.8;
    const dh = (z.w / 2 + 1.0) / (TANV * aspect());
    const dv = (hgt / 2 + 1.7) / TANV;
    goal.t.set(z.cx, rack ? hgt * 0.42 : 0.5, rack ? z.racks[0].zc : z.cz);
    goal.pol = rack ? 1.02 : 0.72;
    goal.dist = Math.max(dh, dv) + z.d / 2 + 1;
    flyAz(-0.3);
    kSmooth = 4.5;
    userMoved = true;
  }
  function applyCam() {
    const sp = Math.sin(cur.pol);
    camera.position.set(cur.t.x + cur.dist * sp * Math.sin(cur.az), cur.t.y + cur.dist * Math.cos(cur.pol), cur.t.z + cur.dist * sp * Math.cos(cur.az));
    camera.lookAt(cur.t);
  }
  function limitGoal() {
    goal.pol = clamp(goal.pol, 0.12, 1.45);
    goal.dist = clamp(goal.dist, 5, maxDist);
    goal.t.x = clamp(goal.t.x, -26, 26);
    goal.t.z = clamp(goal.t.z, -13, 13);
    goal.t.y = clamp(goal.t.y, 0, 6);
  }
  function stepCam(dt: number) {
    const a = reduceMotion ? 1 : 1 - Math.exp(-dt * kSmooth);
    cur.t.lerp(goal.t, a);
    cur.az += (goal.az - cur.az) * a;
    cur.pol += (goal.pol - cur.pol) * a;
    cur.dist += (goal.dist - cur.dist) * a;
    const rest = cur.t.distanceTo(goal.t) + Math.abs(goal.az - cur.az) * 10 + Math.abs(goal.pol - cur.pol) * 10 + Math.abs(goal.dist - cur.dist);
    if (rest < 0.004) {
      cur.t.copy(goal.t);
      cur.az = goal.az;
      cur.pol = goal.pol;
      cur.dist = goal.dist;
      applyCam();
      return false;
    }
    applyCam();
    return true;
  }

  /* ---------- วาดเมื่อจำเป็นเท่านั้น ---------- */
  let running = false;
  let raf = 0;
  let last = 0;
  let pr = Math.min(window.devicePixelRatio || 1, 2);
  let slow = 0;
  let fps = 0;
  let fAcc = 0;
  let fN = 0;
  let perfT = 0;
  function showPerf(idle: boolean) {
    const i = renderer.info.render;
    handlers.onPerf?.(`${i.calls} draw calls · ${Math.round(i.triangles / 100) / 10}k tris · ${idle ? "พักการวาด" : fps + " fps"}`);
  }
  function invalidate() {
    if (running || disposed) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function tick(t: number) {
    if (disposed) return;
    const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
    last = t;
    const moving = stepCam(dt);
    const anim = syncCoils(t);
    const b = selBoxNow();
    if (b) fitBox(selBox, b);
    else selBox.visible = false;
    renderer.render(scene, camera);
    if (dt > 0) {
      fAcc += dt;
      fN++;
      if (fAcc > 0.4) {
        fps = Math.round(fN / fAcc);
        fAcc = 0;
        fN = 0;
      }
    }
    // เครื่องช้า (เฟรมเกิน 30 ms ต่อเนื่อง) = ลดความละเอียดทีละขั้น จนเหลือ 1x
    if (dt > 0.03 && pr > 1) {
      if (++slow > 25) {
        pr = Math.max(1, pr - 0.25);
        slow = 0;
        resize(true);
      }
    } else if (slow > 0) slow--;
    if (moving || anim) {
      if (t - perfT > 300) {
        perfT = t;
        showPerf(false);
      }
      raf = requestAnimationFrame(tick);
    } else {
      running = false;
      showPerf(true);
    }
  }
  function resize(keepView = false) {
    const w = stage.clientWidth;
    const hh = stage.clientHeight;
    if (!w || !hh) return;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
    maxDist = overviewDist() * 1.35;
    sizeLabels();
    if (!keepView && !userMoved) {
      goal.dist = overviewDist();
      cur.dist = goal.dist;
    }
    applyCam();
    invalidate();
  }

  /* ---------- เลือกด้วยการคำนวณจากกล่องของช่อง (ไม่ต้องสร้าง mesh เพิ่ม) ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitP = new THREE.Vector3();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function pick(cx: number, cy: number): (Hit & { box?: THREE.Box3 }) | null {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin;
    let best: (Hit & { box?: THREE.Box3 }) | null = null;
    let bd = Infinity;
    for (const s of SLOTS) {
      if (focus && s.zoneId !== focus.id) continue;
      const box = slotBox.get(s.id)!;
      if (!ray.ray.intersectBox(box, hitP)) continue;
      const d = hitP.distanceTo(o);
      if (d < bd) {
        bd = d;
        best = { kind: "slot", slotId: s.id, zoneId: s.zoneId, box };
      }
    }
    for (const f of floorPicks) {
      if (!ray.ray.intersectBox(f.box, hitP)) continue;
      const d = hitP.distanceTo(o);
      if (d < bd) {
        bd = d;
        best = { kind: "floor", zoneId: f.zoneId, coilId: f.coilId, box: f.box };
      }
    }
    if (best) return best;
    if (ray.ray.intersectPlane(ground, hitP)) for (const z of ZONES) if (z.kind !== "scenery" && Math.abs(hitP.x - z.cx) <= z.w / 2 && Math.abs(hitP.z - z.cz) <= z.d / 2) return { kind: "zone", zoneId: z.id };
    return null;
  }
  function setHover(hit: (Hit & { box?: THREE.Box3 }) | null, e?: PointerEvent) {
    const r = stage.getBoundingClientRect();
    const x = e ? e.clientX - r.left : 0;
    const y = e ? e.clientY - r.top : 0;
    const key = hit ? (hit.kind === "slot" ? hit.slotId : hit.kind === "floor" ? "c" + hit.coilId : hit.zoneId) : null;
    if (key === hoverKey) {
      if (hit) handlers.onHover(hit, x, y);
      return;
    }
    hoverKey = key;
    canvas.style.cursor = hit ? "pointer" : "";
    if (!hit) {
      hovBox.visible = false;
      handlers.onHover(null, 0, 0);
    } else {
      if (hit.box) fitBox(hovBox, hit.box);
      else {
        const z = ZONE_BY_ID.get(hit.zoneId)!;
        hovBox.position.set(z.cx, 0.2, z.cz);
        hovBox.scale.set(z.w, 0.3, z.d);
        hovBox.visible = true;
      }
      handlers.onHover(hit, x, y);
    }
    invalidate();
  }

  /* ---------- เมาส์ / นิ้ว / คีย์บอร์ด ---------- */
  const ptrs = new Map<number, { x: number; y: number }>();
  let downAt: { x: number; y: number; t: number; pan: boolean } | null = null;
  let pinch0 = 0;
  let mid0 = { x: 0, y: 0 };
  function panBy(dx: number, dy: number) {
    const k = cur.dist * 0.0017;
    const ca = Math.cos(cur.az);
    const sa = Math.sin(cur.az);
    goal.t.x -= (ca * dx + sa * dy) * k;
    goal.t.z -= (-sa * dx + ca * dy) * k;
  }
  function touched() {
    kSmooth = 14;
    userMoved = true;
    limitGoal();
    invalidate();
  }
  const two = () => {
    const p = [...ptrs.values()];
    return { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), m: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } };
  };
  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) downAt = { x: e.clientX, y: e.clientY, t: performance.now(), pan: e.button === 2 || e.shiftKey };
    else if (ptrs.size === 2) {
      downAt = null;
      const t = two();
      pinch0 = t.d;
      mid0 = t.m;
    }
    canvas.style.cursor = "grabbing";
    setHover(null);
  };
  const onMove = (e: PointerEvent) => {
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse") setHover(pick(e.clientX, e.clientY), e);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (ptrs.size === 1) {
      if (downAt?.pan) panBy(dx, dy);
      else {
        goal.az -= dx * 0.006;
        goal.pol -= dy * 0.005;
      }
      touched();
    } else if (ptrs.size === 2) {
      const t = two();
      if (pinch0 > 0 && t.d > 0) goal.dist *= pinch0 / t.d;
      panBy(t.m.x - mid0.x, t.m.y - mid0.y);
      pinch0 = t.d;
      mid0 = t.m;
      touched();
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!ptrs.delete(e.pointerId)) return;
    if (ptrs.size > 0) return;
    canvas.style.cursor = "";
    if (e.type === "pointerup" && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 7 && performance.now() - downAt.t < 500) {
      const hit = pick(e.clientX, e.clientY);
      if (hit) handlers.onPick(hit.kind === "slot" ? { kind: "slot", slotId: hit.slotId, zoneId: hit.zoneId } : hit.kind === "floor" ? { kind: "floor", zoneId: hit.zoneId, coilId: hit.coilId } : { kind: "zone", zoneId: hit.zoneId });
    }
    downAt = null;
  };
  const onLeave = () => setHover(null);
  const onMenu = (e: Event) => e.preventDefault();
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    goal.dist *= Math.exp(clamp(e.deltaY, -120, 120) * 0.0013);
    touched();
  };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowLeft") goal.az -= 0.18;
    else if (k === "ArrowRight") goal.az += 0.18;
    else if (k === "ArrowUp") goal.pol -= 0.09;
    else if (k === "ArrowDown") goal.pol += 0.09;
    else if (k === "+" || k === "=") goal.dist *= 0.85;
    else if (k === "-") goal.dist *= 1.18;
    else return;
    e.preventDefault();
    touched();
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("contextmenu", onMenu);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKey);
  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);

  /* ---------- เริ่ม ---------- */
  function drawAllText() {
    if (disposed) return;
    SLOTS.forEach(drawTag);
    atlasTex.needsUpdate = true;
    for (const lb of labels.values()) lb.text = "";
    drawLabels();
    invalidate();
  }
  drawAllText();
  applyFocus();
  goal.dist = cur.dist = overviewDist();
  resize();
  // ฟอนต์ไทยของระบบโหลดเสร็จทีหลัง = วาดตัวหนังสือบนป้ายใหม่อีกรอบ
  document.fonts?.ready.then(drawAllText).catch(() => {});

  return {
    setData(d) {
      const now = loaded ? performance.now() : -1e9;
      let tagsDirty = false;
      for (const s of SLOTS) {
        const prev = slotCoil.get(s.id);
        const next = d.slots[s.id];
        if (next === undefined) {
          if (!prev) continue;
          leaving.push({ pos: [s.x, s.y0 + 0.14 + RO, s.z], zoneId: s.zoneId, tone: prev.tone, t0: performance.now() });
          slotCoil.delete(s.id);
          drawTag(s);
          tagsDirty = true;
        } else if (!prev || prev.id !== next) {
          slotCoil.set(s.id, { id: next, t0: now, tone: toneOf(next) });
          if (!prev) {
            drawTag(s);
            tagsDirty = true;
          }
        }
      }
      if (tagsDirty) atlasTex.needsUpdate = true;
      for (const z of ZONES) {
        if (z.kind !== "floor") continue;
        const prev = floorCoils.get(z.id) ?? [];
        const ids = d.floors[z.id] ?? [];
        prev.forEach((c, k) => {
          if (k < z.cap && !ids.includes(c.id)) leaving.push({ pos: floorPos(z, k), zoneId: z.id, tone: c.tone, t0: performance.now() });
        });
        floorCoils.set(z.id, ids.map((id) => prev.find((c) => c.id === id) ?? { id, t0: now, tone: toneOf(id) }));
      }
      let labelsDirty = false;
      for (const z of ZONES) {
        const text = d.labels[z.id] ?? "";
        if (labelText[z.id] !== text) {
          labelText[z.id] = text;
          labelsDirty = true;
        }
      }
      if (labelsDirty) drawLabels();
      loaded = true;
      invalidate();
    },
    setFocus(zoneId) {
      const z = zoneId ? (ZONE_BY_ID.get(zoneId) ?? null) : null;
      if (z === focus) return;
      focus = z && z.kind !== "scenery" ? z : null;
      if (focus) flyZone(focus);
      else flyOverview();
      applyFocus();
      setHover(null);
      invalidate();
    },
    setSelection(s) {
      sel = s && (s.kind !== "slot" || SLOT_BY_ID.has(s.slotId)) ? s : null;
      invalidate();
    },
    zoom(factor) {
      goal.dist *= factor;
      touched();
    },
    rotate() {
      // ในโซน Rack = พลิกดูอีกด้าน (แถวหลังถูกชั้น 2 บังเมื่อมองจากด้านหน้า)
      goal.az += focus?.kind === "rack" ? Math.PI : Math.PI / 4;
      kSmooth = 4;
      userMoved = true;
      invalidate();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("contextmenu", onMenu);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      for (const lb of labels.values()) {
        lb.sprite.material.map?.dispose();
        lb.sprite.material.dispose();
      }
      scene.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      for (const t of trash) t.dispose();
      renderer.dispose();
    },
  };
}
