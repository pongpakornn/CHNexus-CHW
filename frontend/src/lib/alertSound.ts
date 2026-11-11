"use client";

// 🔊 เสียงแจ้งเตือน (EDP ALERT): เสียงเตือนสร้างจากโค้ด (Web Audio · ไม่ต้องมีไฟล์) + ประโยคไทย แล้วต่อด้วยภาษาพม่า
//   ที่มา: ระบบเตือนแผนงาน (alert-line-multilang.html ของนนท์) · เสียง 18 แบบ · ประโยคสำเร็จรูป 5 แบบ (เสียงผู้หญิง ลงท้าย ค่ะ)
//   เสียงพูด: ไฟล์ที่อัพโหลดเอง (SETUP) > ไฟล์เสียงในระบบของประโยคสำเร็จรูป (/sounds/edp-alert) > เสียงอ่านของเบราว์เซอร์ (Edge + อินเทอร์เน็ต)
//   เบราว์เซอร์ไม่ให้เล่นเสียงจนกว่าผู้ใช้จะกดอะไรบนหน้าสักครั้ง -> unlockAudio() ตอนกดครั้งแรก

export type Sound = { id: number; grp?: string; name: string; desc: string; dur: number; build: (c: AudioContext, o: AudioNode, t: number) => void };
export type Lang = "th" | "my";
export type Preset = { name: string; th: string; my: string; file: number };

function osc(c: AudioContext, out: AudioNode, t0: number, dur: number, f1: number, type: OscillatorType, gain: number, f2?: number) {
  const o = c.createOscillator(),
    g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t0);
  if (f2) o.frequency.linearRampToValueAtTime(f2, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}
// ระฆังโลหะ: หลายความถี่ซ้อน
function bell(c: AudioContext, o: AudioNode, t: number, f: number, dur: number, g: number) {
  for (const [m, a] of [
    [1, 1],
    [2.76, 0.6],
    [5.4, 0.35],
    [8.93, 0.18],
  ])
    osc(c, o, t, dur / (m > 3 ? 2 : 1), f * m, "sine", g * a);
}

const G1 = "เสียงสำหรับไลน์ผลิต (ดัง ทางการ)";
const G2 = "เสียงทั่วไป / สำนักงาน";
export const SOUNDS: Sound[] = [
  { id: 1, grp: G1, name: "Andon 3 โทนลง (สัญญาณไลน์ผลิต)", desc: "มาตรฐานโรงงาน ชัดเจน ไม่ตกใจ", dur: 1.5, build: (c, o, t) => [[1175, 0], [988, 0.4], [784, 0.8]].forEach(([f, d]) => (osc(c, o, t + d, 0.38, f, "square", 0.4), osc(c, o, t + d, 0.38, f * 2, "sine", 0.25))) },
  { id: 2, grp: G1, name: "ไซเรนโรงงาน (ยาว ขึ้น-ลง)", desc: "ดังกว่าเสียงเครื่องจักร เหมาะเลยกำหนดนาน", dur: 3.4, build: (c, o, t) => { for (let i = 0; i < 2; i++) for (const dt of [0, 0.004]) { osc(c, o, t + i * 1.6 + dt, 0.8, 450, "sawtooth", 0.4, 950); osc(c, o, t + i * 1.6 + 0.8 + dt, 0.8, 950, "sawtooth", 0.4, 450); } } },
  { id: 3, grp: G1, name: "แตร Klaxon (3 ครั้ง)", desc: "หนัก ห้วน ใช้เตือนระดับสูง", dur: 2.2, build: (c, o, t) => { for (let i = 0; i < 3; i++) { osc(c, o, t + i * 0.7, 0.5, 330, "sawtooth", 0.45); osc(c, o, t + i * 0.7, 0.5, 336, "square", 0.3); } } },
  { id: 4, grp: G1, name: "บัซเซอร์อุตสาหกรรม", desc: "เสียงทุ้มหนา ทะลุเสียงรบกวน", dur: 2.6, build: (c, o, t) => { for (let i = 0; i < 3; i++) { const s = t + i * 0.85; osc(c, o, s, 0.6, 120, "square", 0.3); osc(c, o, s, 0.6, 240, "sawtooth", 0.3); osc(c, o, s, 0.6, 480, "square", 0.2); } } },
  { id: 5, grp: G1, name: "สองโทนสลับ (ปี๊-ป่อ ดัง)", desc: "ได้ยินไกล ใช้ในพื้นที่กว้าง", dur: 3.0, build: (c, o, t) => { for (let i = 0; i < 8; i++) osc(c, o, t + i * 0.35, 0.33, i % 2 ? 770 : 960, "square", 0.55); } },
  { id: 6, grp: G1, name: "กระดิ่งโรงงาน (เหล็ก รัว)", desc: "ก้องแบบโลหะ ฟังรู้ว่าเป็นกระดิ่ง", dur: 2.6, build: (c, o, t) => { for (let i = 0; i < 4; i++) bell(c, o, t + i * 0.38, 700, 0.9, 0.5); } },
  { id: 7, grp: G1, name: "เตือนหยุดเครื่อง (รัวถี่)", desc: "ถี่ ดึงความสนใจสูงสุด", dur: 2.1, build: (c, o, t) => { for (let b = 0; b < 2; b++) for (let i = 0; i < 8; i++) osc(c, o, t + b * 1.0 + i * 0.09, 0.05, 2400, "square", 0.45); } },
  { id: 8, grp: G1, name: "Chime ประกาศไลน์ผลิต (4 โน้ตขึ้น)", desc: "ทางการ ใช้นำก่อนประกาศเสียงพูด", dur: 2.4, build: (c, o, t) => [[659, 0], [784, 0.45], [988, 0.9], [1319, 1.35]].forEach(([f, d]) => (osc(c, o, t + d, 0.55, f, "triangle", 0.55), osc(c, o, t + d, 0.55, f * 2, "sine", 0.2))) },
  { id: 9, grp: G2, name: "ปี๊บสั้น (เบา)", desc: "เตือนระดับแรก สุภาพ", dur: 0.6, build: (c, o, t) => (osc(c, o, t, 0.18, 880, "sine", 0.8), osc(c, o, t + 0.25, 0.18, 880, "sine", 0.8)) },
  { id: 10, grp: G2, name: "ติ๊ง-ต่อง (ออฟฟิศ)", desc: "เสียงกริ่งประตู ฟังสบาย", dur: 1.2, build: (c, o, t) => (osc(c, o, t, 0.5, 784, "triangle", 0.8), osc(c, o, t + 0.45, 0.7, 587, "triangle", 0.8)) },
  { id: 11, grp: G2, name: "นาฬิกาปลุก (ปิ๊ดๆๆๆ)", desc: "ชัดเจน ได้ยินทั้งห้อง", dur: 1.5, build: (c, o, t) => { for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) osc(c, o, t + r * 0.7 + i * 0.12, 0.08, 1800, "square", 0.35); } },
  { id: 12, grp: G2, name: "ไซเรน (เร่งด่วน)", desc: "เหมาะกับเลยกำหนดหลายวัน", dur: 1.9, build: (c, o, t) => { for (let i = 0; i < 3; i++) { osc(c, o, t + i * 0.6, 0.3, 600, "sawtooth", 0.4, 1200); osc(c, o, t + i * 0.6 + 0.3, 0.3, 1200, "sawtooth", 0.4, 600); } } },
  { id: 13, grp: G2, name: "ระฆังเตือน", desc: "นุ่ม เสียงก้องยาว", dur: 1.4, build: (c, o, t) => (osc(c, o, t, 1.2, 1046, "sine", 0.6), osc(c, o, t, 1.0, 1568, "sine", 0.25), osc(c, o, t, 0.8, 2093, "sine", 0.12)) },
  { id: 14, grp: G2, name: "เตือนภัย 3 จังหวะ", desc: "ดังเด่น", dur: 1.2, build: (c, o, t) => [0, 0.35, 0.7].forEach((d) => (osc(c, o, t + d, 0.25, 1000, "square", 0.35), osc(c, o, t + d, 0.25, 1500, "square", 0.25))) },
  { id: 15, grp: G2, name: "ประกาศ 3 โน้ต (สนามบิน)", desc: "ทางการ · ค่าเริ่มต้น", dur: 1.6, build: (c, o, t) => (osc(c, o, t, 0.45, 523, "triangle", 0.8), osc(c, o, t + 0.45, 0.45, 659, "triangle", 0.8), osc(c, o, t + 0.9, 0.6, 784, "triangle", 0.8)) },
  { id: 16, grp: G2, name: "เสียงเรียกคิว (2 โน้ตขึ้น)", desc: "สุภาพ", dur: 1.1, build: (c, o, t) => (osc(c, o, t, 0.35, 880, "sine", 0.8), osc(c, o, t + 0.3, 0.6, 1175, "sine", 0.8)) },
  { id: 17, grp: G2, name: "เตือนเครื่องจักร (ต่ำ-สูง)", desc: "หนักแน่น", dur: 1.8, build: (c, o, t) => { for (let i = 0; i < 4; i++) { osc(c, o, t + i * 0.4, 0.2, 400, "square", 0.3); osc(c, o, t + i * 0.4 + 0.2, 0.2, 800, "square", 0.3); } } },
  { id: 18, grp: G2, name: "พัลส์เร่งด่วน (รัว)", desc: "ถี่", dur: 1.4, build: (c, o, t) => { for (let i = 0; i < 12; i++) osc(c, o, t + i * 0.1, 0.06, 1500, "square", 0.3); } },
];
export const soundOf = (id: number) => SOUNDS.find((s) => s.id === id) ?? SOUNDS[14];

// ประโยคสำเร็จรูป (ไทย ลงท้าย ค่ะ · พม่าเป็นร่างแปล ควรให้คนพม่าตรวจ) · file = ไฟล์เสียงในระบบ /sounds/edp-alert/{th|my}{file}.mp3
//   ⚠ ข้อความต้องตรงกับไฟล์เสียงทุกตัวอักษร (แก้ประโยค = ใช้ไฟล์ที่อัพโหลดเอง หรือเสียงอ่านของเบราว์เซอร์แทน)
export const PRESETS: Preset[] = [
  {
    name: "ทางการ",
    file: 0,
    th: "ขอเรียนแจ้งให้ทราบ ขณะนี้มีแผนงานที่ยังไม่ได้รับการอัพเดทตามเวลาที่กำหนด ขอความร่วมมือผู้รับผิดชอบดำเนินการอัพเดทแผนงานด้วยค่ะ ขอบคุณค่ะ",
    my: "အသိပေးကြေညာချက်။ ယခုအချိန်တွင် သတ်မှတ်ထားသောအချိန်အတွင်း အပ်ဒိတ်မလုပ်ရသေးသော အလုပ်အစီအစဉ် ရှိနေပါသည်။ တာဝန်ရှိသူများ ကျေးဇူးပြု၍ အလုပ်အစီအစဉ်ကို အပ်ဒိတ်လုပ်ပေးပါ။ ကျေးဇူးတင်ပါသည်။",
  },
  {
    name: "ตามที่นนท์กำหนด (ค่าเริ่มต้น)",
    file: 1,
    th: "ขณะนี้มีแผนงานที่ยังไม่ได้อัพเดท ตามเวลาที่ได้กำหนดที่แผนงาน กรุณาอัพเดทแผนงานด้วยค่ะ ขอบคุณค่ะ",
    my: "ယခုအချိန်တွင် အလုပ်အစီအစဉ်၌ သတ်မှတ်ထားသောအချိန်အတွင်း အပ်ဒိတ်မလုပ်ရသေးသော အလုပ်အစီအစဉ် ရှိနေပါသည်။ ကျေးဇူးပြု၍ အပ်ဒိတ်လုပ်ပေးပါ။ ကျေးဇူးတင်ပါသည်။",
  },
  {
    name: "สุภาพ นุ่มนวล",
    file: 2,
    th: "ขออนุญาตแจ้งเตือน แผนงานยังไม่ได้รับการอัพเดทตามเวลาที่กำหนด รบกวนผู้รับผิดชอบอัพเดทแผนงานด้วยค่ะ ขอบคุณมากค่ะ",
    my: "ခွင့်ပြုပါ၊ သတိပေးလိုပါသည်။ သတ်မှတ်ထားသောအချိန်အတွင်း အလုပ်အစီအစဉ်ကို အပ်ဒိတ်မလုပ်ရသေးပါ။ တာဝန်ရှိသူများ အပ်ဒိတ်လုပ်ပေးပါရန် မေတ္တာရပ်ခံပါသည်။ အများကြီး ကျေးဇူးတင်ပါသည်။",
  },
  {
    name: "กระชับ",
    file: 3,
    th: "แจ้งเตือน มีแผนงานที่ยังไม่ได้อัพเดทตามกำหนดเวลา กรุณาอัพเดทแผนงานด้วยค่ะ",
    my: "သတိပေးချက်။ အချိန်မီ အပ်ဒိတ်မလုပ်ရသေးသော အလုပ်အစီအစဉ် ရှိပါသည်။ ကျေးဇူးပြု၍ အပ်ဒိတ်လုပ်ပေးပါ။",
  },
  {
    name: "เร่งด่วน",
    file: 4,
    th: "ประกาศ แผนงานเลยกำหนดเวลาการอัพเดทแล้ว ขอให้ผู้รับผิดชอบอัพเดทแผนงานโดยด่วนที่สุดค่ะ",
    my: "ကြေညာချက်။ အလုပ်အစီအစဉ် အပ်ဒိတ်လုပ်ရမည့်အချိန် ကျော်လွန်သွားပါပြီ။ တာဝန်ရှိသူများ အလုပ်အစီအစဉ်ကို အမြန်ဆုံး အပ်ဒိတ်လုပ်ပေးပါ။",
  },
];

// ไฟล์เสียงในระบบของประโยคนี้ (ตรงกับประโยคสำเร็จรูปทุกตัวอักษร)
export function builtinVoice(lang: Lang, text: string) {
  const t = text.trim();
  const p = PRESETS.find((x) => x[lang] === t);
  return p ? `/sounds/edp-alert/${lang}${p.file}.mp3` : null;
}

// ---------------------------------------------------------------- ระบบเสียง (ใช้ร่วมกันทั้งหน้า)
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let vol: GainNode | null = null;
let current: HTMLAudioElement | null = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    // เสียงทั้งหมด -> ตัวจำกัดเสียง (กันแตก) -> ความดัง -> ลำโพง
    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 4;
    comp.ratio.value = 20;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    vol = ctx.createGain();
    master.connect(comp);
    comp.connect(vol);
    vol.connect(ctx.destination);
  }
  return ctx;
}

/** เล่นเสียงได้หรือยัง (เบราว์เซอร์ปลดล็อกหลังผู้ใช้กดบนหน้าครั้งแรก) */
export const audioReady = () => !!ctx && ctx.state === "running";

/** เรียกตอนผู้ใช้กด / พิมพ์ (ปลดล็อกเสียงของหน้านี้) */
export async function unlockAudio() {
  try {
    await audio().resume();
  } catch {
    /* ยังไม่ได้ */
  }
  return audioReady();
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res) => {
    if (signal?.aborted) return res();
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), res()), { once: true });
  });

/** เล่นเสียงเตือน 1 ครั้ง (รอจนจบ) */
export async function playChime(id: number, volume = 1, signal?: AbortSignal) {
  const c = audio();
  try {
    await c.resume();
  } catch {
    /* เบราว์เซอร์ยังไม่ให้เล่น */
  }
  if (signal?.aborted || !master || !vol) return;
  const s = soundOf(id);
  vol.gain.cancelScheduledValues(c.currentTime);
  vol.gain.setValueAtTime(Math.max(0.05, Math.min(1.5, volume)), c.currentTime);
  s.build(c, master, c.currentTime + 0.05);
  await wait(s.dur * 1000 + 150, signal);
}

// เสียงอ่านของเบราว์เซอร์ (สำรอง) · เลือกเสียงผู้หญิง / Online (Natural) ก่อน
function pickVoice(lang: Lang) {
  if (!("speechSynthesis" in window)) return null;
  const re = lang === "th" ? /^th([-_]|$)/i : /^my([-_]|$)/i;
  const list = speechSynthesis.getVoices().filter((v) => re.test(v.lang));
  const score = (v: SpeechSynthesisVoice) => (/natural|online/i.test(v.name) ? 0 : 2) + (/premwadee|nilar|female|หญิง/i.test(v.name) ? 0 : 1);
  return list.sort((a, b) => score(a) - score(b))[0] ?? null;
}

/** มีเสียงอ่านของเบราว์เซอร์ภาษานี้ไหม (ใช้แสดงสถานะที่ SETUP) */
export const hasBrowserVoice = (lang: Lang) => !!pickVoice(lang);

function speakTts(text: string, lang: Lang, rate: number, volume: number, signal?: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    const v = pickVoice(lang);
    if (!v || !text.trim() || signal?.aborted) return resolve(false);
    let done = false;
    const fin = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(lang === "th" ? text.replace(/อัพเดท/g, "อัปเดต") : text);
    u.voice = v;
    u.lang = v.lang;
    u.rate = rate || 1;
    u.volume = Math.max(0, Math.min(1, volume));
    u.onend = () => fin(true);
    u.onerror = () => fin(false);
    signal?.addEventListener("abort", () => (speechSynthesis.cancel(), fin(false)), { once: true });
    setTimeout(() => fin(true), 45_000);
    speechSynthesis.speak(u);
  });
}

function playUrl(src: string, volume: number, signal?: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) return resolve(false);
    const a = new Audio(src);
    current = a;
    a.volume = Math.max(0, Math.min(1, volume));
    let done = false;
    const fin = (ok: boolean) => {
      if (done) return;
      done = true;
      if (current === a) current = null;
      resolve(ok);
    };
    a.onended = () => fin(true);
    a.onerror = () => fin(false);
    signal?.addEventListener("abort", () => (a.pause(), fin(false)), { once: true });
    a.play().catch(() => fin(false));
  });
}

export type Speech = { text: string; lang: Lang; url?: string | null; rate: number; volume: number };

/** พูด 1 ประโยค: ไฟล์ที่อัพโหลด > ไฟล์ในระบบ > เสียงอ่านของเบราว์เซอร์ · true = ได้ยินแล้ว */
export async function speak(s: Speech, signal?: AbortSignal) {
  if (!s.text.trim() || signal?.aborted) return false;
  for (const src of [s.url, builtinVoice(s.lang, s.text)]) if (src && (await playUrl(src, s.volume, signal))) return true;
  if (signal?.aborted) return false;
  return speakTts(s.text, s.lang, s.rate, s.volume, signal);
}

export type AlertSoundCfg = {
  on: boolean;
  soundId: number;
  leadRepeat: number;
  endChime: boolean;
  gapSeconds: number;
  alarmVolume: number;
  voiceVolume: number;
  voiceRate: number;
  msgTh: string;
  msgMy: string;
  voiceTh?: string | null;
  voiceMy?: string | null;
};

/** 1 รอบ: เสียงเตือน (× leadRepeat) -> ไทย -> พม่า -> เสียงปิดท้าย */
export async function playOnce(cfg: AlertSoundCfg, signal?: AbortSignal) {
  for (let i = 0; i < Math.max(1, cfg.leadRepeat); i++) {
    if (signal?.aborted) return;
    await playChime(cfg.soundId, cfg.alarmVolume, signal);
  }
  await speak({ text: cfg.msgTh, lang: "th", url: cfg.voiceTh, rate: cfg.voiceRate, volume: cfg.voiceVolume }, signal);
  if (cfg.msgMy.trim()) {
    await wait(450, signal);
    await speak({ text: cfg.msgMy, lang: "my", url: cfg.voiceMy, rate: cfg.voiceRate, volume: cfg.voiceVolume }, signal);
  }
  if (cfg.endChime) {
    await wait(300, signal);
    await playChime(cfg.soundId, cfg.alarmVolume, signal);
  }
}

/** วนเสียงจนกว่าจะ abort (หน้าต่างแจ้งเตือนหาย = MARK ครบ / CANCEL) · หลายแท็บในเครื่องเดียว = ดังแท็บเดียว */
export async function loopAlert(cfg: AlertSoundCfg, signal: AbortSignal) {
  const run = async () => {
    while (!signal.aborted) {
      await playOnce(cfg, signal);
      await wait(Math.max(5, cfg.gapSeconds) * 1000, signal);
    }
  };
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return run();
  try {
    await locks.request("nexus-edp-alert-sound", { signal }, run);
  } catch {
    /* abort ระหว่างรอคิว */
  }
}

/** หยุดทุกเสียงทันที */
export function stopAll() {
  current?.pause();
  current = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (ctx && vol) {
    vol.gain.cancelScheduledValues(ctx.currentTime);
    vol.gain.setValueAtTime(0, ctx.currentTime);
  }
}
