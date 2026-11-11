"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loading } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { api, upload } from "@/lib/api";
import { PRESETS, SOUNDS, builtinVoice, hasBrowserVoice, playChime, playOnce, speak, stopAll, unlockAudio, type AlertSoundCfg, type Lang } from "@/lib/alertSound";

// ⏰ SETUP › EDP ALERT (ทั้งระบบ): แจ้งเตือนการ์ด EDP ที่เลยเวลา START แล้วยังไม่ MARK SUCCESS
//   เปิด / ปิด · เลยเวลากี่นาทีจึงแจ้ง · กด CANCEL แล้วแจ้งซ้ำทุกกี่นาที · เฉพาะแผนที่กด START แล้ว
//   👥 ผู้รับแจ้งเตือน: เลือก UserID (ไม่เลือก = ทุกคนที่ MARK SUCCESS ได้) แบบ MIN REPORT
//   🔊 เสียง: เสียงเตือน (18 แบบ) -> ประโยคไทย -> ประโยคพม่า -> เสียงปิดท้าย วนทุก n วินาที จนกว่าจะ MARK ครบ / CANCEL (ซ่อนชั่วคราว)
//   หน้าต่างแจ้งเตือนขึ้นเฉพาะในระบบ EDP PLANNING · SAVE แล้วทุกเครื่องใช้ค่าใหม่ทันที
type Snd = Omit<AlertSoundCfg, "voiceTh" | "voiceMy"> & { voiceTh?: string | null; voiceMy?: string | null };
type Cfg = { enabled: boolean; graceMinutes: number; remindMinutes: number; onlyStarted: boolean; updatedBy: string | null; updatedDate: string | null; users: string[]; sound: Snd | null };
type U = { userId: string; name: string | null; dept: string | null };
const L = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";
const sameUsers = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x) => b.some((y) => y.toLowerCase() === x.toLowerCase()));
const SND_KEYS: (keyof Snd)[] = ["on", "soundId", "leadRepeat", "endChime", "gapSeconds", "alarmVolume", "voiceVolume", "voiceRate", "msgTh", "msgMy"];

export function EdpAlertPanel({ onDirty }: { onDirty: (v: boolean) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [ready, setReady] = useState(true);
  const [hasSound, setHasSound] = useState(false);
  const [orig, setOrig] = useState<Cfg | null>(null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [users, setUsers] = useState<U[]>([]);
  const [busy, setBusy] = useState(false);
  const [pickUsers, setPickUsers] = useState(false);
  const [key, setKey] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const playAc = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upLang = useRef<Lang>("th");
  const [, setVoicesTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await api<{ ready: boolean; sound?: boolean; settings?: Cfg; users?: U[] | null }>("/edp/alert/settings");
      setReady(r.ready);
      setHasSound(!!r.sound);
      setUsers(r.users ?? []);
      if (r.settings) {
        setOrig(r.settings);
        setCfg(r.settings);
      }
    } catch (e) {
      toast.show("ERROR", "โหลดการตั้งค่า EDP ALERT ไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  // รายชื่อเสียงอ่านของเบราว์เซอร์โหลดช้า -> วาดสถานะใหม่เมื่อพร้อม
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const on = () => setVoicesTick((x) => x + 1);
    speechSynthesis.addEventListener("voiceschanged", on);
    return () => speechSynthesis.removeEventListener("voiceschanged", on);
  }, []);
  // ออกจากหน้า = หยุดเสียงที่ลองฟังอยู่
  useEffect(() => () => (playAc.current?.abort(), stopAll()), []);

  const dirty = useMemo(() => {
    if (!cfg || !orig) return false;
    if (cfg.enabled !== orig.enabled || cfg.graceMinutes !== orig.graceMinutes || cfg.remindMinutes !== orig.remindMinutes || cfg.onlyStarted !== orig.onlyStarted) return true;
    if (!sameUsers(cfg.users, orig.users)) return true;
    return !!cfg.sound && !!orig.sound && SND_KEYS.some((k) => cfg.sound![k] !== orig.sound![k]);
  }, [cfg, orig]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  if (!ready) return <p className="rounded-xl bg-[#fff3e0] px-3 py-2 text-xs font-bold text-[#e65100]">⚠ Run database/nexus/29_EDP_Alert.sql first - cannot set EDP ALERT yet</p>;
  if (!cfg) return <Loading />;
  const set = (p: Partial<Cfg>) => setCfg((c) => (c ? { ...c, ...p } : c));
  const setS = (p: Partial<Snd>) => setCfg((c) => (c && c.sound ? { ...c, sound: { ...c.sound, ...p } } : c));
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || 0));
  const snd = cfg.sound;

  async function save() {
    if (!cfg) return;
    if (snd?.on && !snd.msgTh.trim()) return toast.show("WARNING", "กรุณากรอกประโยคภาษาไทย หรือปิดเสียงแจ้งเตือน", "warn");
    setBusy(true);
    try {
      const body = {
        enabled: cfg.enabled,
        graceMinutes: cfg.graceMinutes,
        remindMinutes: cfg.remindMinutes,
        onlyStarted: cfg.onlyStarted,
        ...(snd ? { users: cfg.users, soundOn: snd.on, soundId: snd.soundId, leadRepeat: snd.leadRepeat, endChime: snd.endChime, gapSeconds: snd.gapSeconds, alarmVolume: snd.alarmVolume, voiceVolume: snd.voiceVolume, voiceRate: snd.voiceRate, msgTh: snd.msgTh, msgMy: snd.msgMy } : {}),
      };
      const r = await api<{ message: string }>("/edp/alert/settings", { method: "POST", body });
      toast.show("Saved", r.message, "ok");
      await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // ▶ ลองฟัง (กดซ้ำ = หยุด)
  async function play(what: string, f: (s: AbortSignal) => Promise<unknown>) {
    playAc.current?.abort();
    stopAll();
    if (playing === what) return setPlaying(null);
    const ac = new AbortController();
    playAc.current = ac;
    setPlaying(what);
    await unlockAudio();
    try {
      await f(ac.signal);
    } finally {
      if (playAc.current === ac) setPlaying(null);
    }
  }

  // สถานะเสียงพูดของประโยค: ไฟล์ที่อัพโหลด > ไฟล์ในระบบ > เสียงอ่านของเบราว์เซอร์
  const voiceState = (lang: Lang) => {
    if (!snd) return null;
    const text = lang === "th" ? snd.msgTh : snd.msgMy;
    const saved = lang === "th" ? orig?.sound?.msgTh : orig?.sound?.msgMy;
    const up = text === saved ? (lang === "th" ? snd.voiceTh : snd.voiceMy) : null;
    if (!text.trim()) return { cls: "is-off", label: "ไม่พูดประโยคนี้", url: null };
    if (up) return { cls: "is-up", label: "ไฟล์เสียงที่อัพโหลด", url: up };
    if (builtinVoice(lang, text)) return { cls: "is-sys", label: "ไฟล์เสียงในระบบ", url: null };
    return hasBrowserVoice(lang)
      ? { cls: "is-tts", label: "เสียงอ่านของเบราว์เซอร์ (เครื่องนี้มีเสียงภาษานี้)", url: null }
      : { cls: "is-warn", label: "ไม่มีไฟล์เสียง · เครื่องนี้ไม่มีเสียงอ่านภาษานี้ (ใช้ Edge + อินเทอร์เน็ต หรืออัพโหลดไฟล์เสียง)", url: null };
  };

  async function uploadVoice(file: File) {
    if (!snd) return;
    const lang = upLang.current;
    const text = (lang === "th" ? snd.msgTh : snd.msgMy).trim();
    setBusy(true);
    try {
      const r = await upload<{ message: string; url: string }>("/edp/alert/voice", file, { lang, text });
      toast.show("UPLOADED", r.message + (dirty ? "\n\nอย่าลืมกด SAVE เพื่อใช้ประโยคนี้" : ""), "ok");
      // ไฟล์ผูกกับข้อความ -> ใส่ URL ให้ทั้งค่าที่แก้อยู่และค่าที่บันทึกไว้ (ถ้าข้อความตรงกัน)
      const k = lang === "th" ? "voiceTh" : "voiceMy";
      setCfg((c) => (c?.sound ? { ...c, sound: { ...c.sound, [k]: r.url } } : c));
      setOrig((c) => (c?.sound ? { ...c, sound: { ...c.sound, [k]: r.url, ...(lang === "th" ? { msgTh: text } : { msgMy: text }) } } : c));
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteVoice(lang: Lang) {
    if (!snd) return;
    const text = lang === "th" ? snd.msgTh : snd.msgMy;
    if (!(await dlg.confirm({ title: "DELETE VOICE", danger: true, ok: "DELETE", message: `ลบไฟล์เสียงที่อัพโหลดของประโยค${lang === "th" ? "ภาษาไทย" : "ภาษาพม่า"}?\n\nหลังลบจะใช้ไฟล์เสียงในระบบ (ถ้าเป็นประโยคสำเร็จรูป) หรือเสียงอ่านของเบราว์เซอร์แทน` }))) return;
    try {
      const r = await api<{ message: string }>("/edp/alert/voice/delete", { method: "POST", body: { lang, text } });
      toast.show("DELETE", r.message, "ok");
      await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  const chips = (list: [number, string][], value: number, on: (v: number) => void, min: number, max: number, label: string, unit = "นาที") => (
    <div className="mr-chips">
      {list.map(([m, t]) => (
        <button key={m} type="button" className={value === m ? "is-on" : ""} onClick={() => on(m)}>
          {t}
        </button>
      ))}
      <input type="number" min={min} max={max} value={value} onChange={(e) => on(clamp(Number(e.target.value), min, max))} aria-label={label} />
      <small>{unit}</small>
    </div>
  );

  const presetIdx = snd ? PRESETS.findIndex((p) => p.th === snd.msgTh.trim() && p.my === snd.msgMy.trim()) : -1;
  const sel = cfg.users;
  const has = (id: string) => sel.some((x) => x.toLowerCase() === id.toLowerCase());
  const q = key.trim().toLowerCase();
  const list = users.filter((u) => !q || [u.userId, u.name, u.dept].some((v) => v?.toLowerCase().includes(q))).slice(0, 300);
  const groups = SOUNDS.reduce<{ grp: string; items: typeof SOUNDS }[]>((a, s) => {
    const g = a.find((x) => x.grp === s.grp);
    if (g) g.items.push(s);
    else a.push({ grp: s.grp ?? "", items: [s] });
    return a;
  }, []);

  return (
    <div className="grid gap-4">
      <p className="text-xs font-bold text-ink-soft">
        การ์ดของรอบ / กะปัจจุบันที่เลยเวลา START แล้วแต่ยังไม่กด MARK SUCCESS = หน้าต่างแจ้งเตือนกลางจอ (เฉพาะในระบบ EDP PLANNING) · กด CANCEL / ✕ = ซ่อนและหยุดเสียงชั่วคราว แล้วแจ้งซ้ำตามเวลาด้านล่าง จนกว่าจะ MARK ครบ (ไม่มีปิดถาวร) · ใช้กับทั้งระบบ
      </p>
      <div className="mr-set">
        <button type="button" role="switch" aria-checked={cfg.enabled} className={`sw ${cfg.enabled ? "is-on" : ""}`} onClick={() => set({ enabled: !cfg.enabled })}>
          <span className="sw-track" />
          {cfg.enabled ? "แจ้งเตือน : ON" : "แจ้งเตือน : OFF"}
        </button>
        <div>
          <span className={L}>เลยเวลา START (ปลาย) กี่นาทีจึงแจ้งเตือน</span>
          {chips(
            [
              [0, "ทันที"],
              [5, "5 นาที"],
              [10, "10 นาที"],
              [15, "15 นาที"],
              [30, "30 นาที"],
            ],
            cfg.graceMinutes,
            (v) => set({ graceMinutes: v }),
            0,
            240,
            "เลยเวลากี่นาที",
          )}
        </div>
        <div>
          <span className={L}>กด CANCEL / ✕ แล้วแจ้งเตือนซ้ำทุก</span>
          {chips(
            [
              [5, "5 นาที"],
              [10, "10 นาที"],
              [15, "15 นาที"],
              [30, "30 นาที"],
              [60, "1 ชม."],
            ],
            cfg.remindMinutes,
            (v) => set({ remindMinutes: v }),
            1,
            480,
            "แจ้งซ้ำทุก",
          )}
        </div>
        <button type="button" role="switch" aria-checked={cfg.onlyStarted} className={`sw ${cfg.onlyStarted ? "is-on" : ""}`} onClick={() => set({ onlyStarted: !cfg.onlyStarted })}>
          <span className="sw-track" />
          {cfg.onlyStarted ? "เฉพาะแผนที่กด START แล้ว" : "ทุกแผนของกะปัจจุบัน"}
        </button>
      </div>

      {!hasSound && <p className="rounded-xl bg-[#fff3e0] px-3 py-2 text-xs font-bold text-[#e65100]">⚠ Run database/nexus/40_EDP_Alert_Sound_Users.sql first - ยังตั้งผู้รับแจ้งเตือน / เสียงไม่ได้</p>}

      {/* 👥 ผู้รับแจ้งเตือน */}
      {hasSound && (
        <div className="eas-sec">
          <div className="eas-sec-head">
            <b>👥 ผู้รับแจ้งเตือน</b>
            <span>{sel.length ? `เลือกแล้ว ${sel.length} คน · แจ้งเตือน (และเสียง) เฉพาะ UserID ที่เลือก` : "ยังไม่เลือก = ทุกคนที่ MARK SUCCESS ได้ (แบบเดิม)"}</span>
            <button type="button" className={`mr-users-btn ml-auto ${sel.length ? "is-set" : ""}`} onClick={() => (setPickUsers((v) => !v), setKey(""))}>
              {pickUsers ? "DONE" : "👥 เลือกผู้รับ"}
            </button>
          </div>
          {sel.length > 0 && (
            <div className="mr-users-sel">
              {sel.map((id) => (
                <button key={id} type="button" onClick={() => set({ users: sel.filter((x) => x.toLowerCase() !== id.toLowerCase()) })} title="เอาออก">
                  {users.find((u) => u.userId.toLowerCase() === id.toLowerCase())?.name || id} <i>✕</i>
                </button>
              ))}
            </div>
          )}
          {pickUsers && (
            <div className="mr-users">
              <div className="mr-users-head">
                <span>ผู้ที่เลือกต้องมีสิทธิ์ดู EDP › Plan Submission · ปุ่ม MARK SUCCESS ใช้ได้เฉพาะผู้ที่มีสิทธิ์แก้ไข</span>
                <button type="button" className="fill-btn is-sm ml-auto" disabled={!sel.length} onClick={() => set({ users: [] })}>
                  ↺ ทุกคนที่ MARK ได้
                </button>
              </div>
              <input className="field" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ค้นหา USER ID / ชื่อ / แผนก" aria-label="ค้นหาผู้ใช้" />
              <div className="mr-users-list">
                {list.map((u) => (
                  <label key={u.userId} className={has(u.userId) ? "is-on" : ""}>
                    <input type="checkbox" checked={has(u.userId)} onChange={() => set({ users: has(u.userId) ? sel.filter((x) => x.toLowerCase() !== u.userId.toLowerCase()) : [...sel, u.userId] })} />
                    <b>{u.userId}</b>
                    <span>{u.name || "-"}</span>
                    <small>{u.dept || ""}</small>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 🔊 เสียงแจ้งเตือน */}
      {snd && (
        <div className="eas-sec">
          <div className="eas-sec-head">
            <b>🔊 เสียงแจ้งเตือน</b>
            <span>เสียงเตือน → ประโยคไทย → ประโยคพม่า{snd.endChime ? " → เสียงปิดท้าย" : ""} → เว้น {snd.gapSeconds} วินาที → วนซ้ำ จนกว่าจะ MARK ครบ / CANCEL</span>
            <button type="button" role="switch" aria-checked={snd.on} className={`sw ml-auto ${snd.on ? "is-on" : ""}`} onClick={() => setS({ on: !snd.on })}>
              <span className="sw-track" />
              {snd.on ? "เสียง : ON" : "เสียง : OFF"}
            </button>
          </div>

          <div className={`grid gap-4 ${snd.on ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!snd.on}>
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <span className={L}>เสียงนำกี่รอบ</span>
                {chips(
                  [
                    [1, "1 รอบ"],
                    [2, "2 รอบ"],
                    [3, "3 รอบ"],
                  ],
                  snd.leadRepeat,
                  (v) => setS({ leadRepeat: v }),
                  1,
                  5,
                  "เสียงนำกี่รอบ",
                  "รอบ",
                )}
              </div>
              <div>
                <span className={L}>เว้นแล้ววนซ้ำทุก</span>
                {chips(
                  [
                    [15, "15 วิ"],
                    [30, "30 วิ"],
                    [60, "1 นาที"],
                    [120, "2 นาที"],
                  ],
                  snd.gapSeconds,
                  (v) => setS({ gapSeconds: v }),
                  5,
                  600,
                  "เว้นกี่วินาที",
                  "วินาที",
                )}
              </div>
              <label className="eas-range">
                <span className={L}>ความดังเสียงเตือน {Math.round(snd.alarmVolume * 100)}%</span>
                <input type="range" min={0.2} max={1.2} step={0.05} value={snd.alarmVolume} onChange={(e) => setS({ alarmVolume: Number(e.target.value) })} />
              </label>
              <label className="eas-range">
                <span className={L}>ความดังเสียงพูด {Math.round(snd.voiceVolume * 100)}%</span>
                <input type="range" min={0.1} max={1} step={0.05} value={snd.voiceVolume} onChange={(e) => setS({ voiceVolume: Number(e.target.value) })} />
              </label>
              <button type="button" role="switch" aria-checked={snd.endChime} className={`sw ${snd.endChime ? "is-on" : ""}`} onClick={() => setS({ endChime: !snd.endChime })}>
                <span className="sw-track" />
                {snd.endChime ? "เสียงเตือนปิดท้ายประโยค : ON" : "เสียงเตือนปิดท้ายประโยค : OFF"}
              </button>
              <p className="text-[11px] font-semibold text-ink-soft">มีตัวจำกัดเสียงกันแตกให้แล้ว · ถ้าต้องการให้ดังกว่าเสียงเครื่องจักร ให้ปรับที่ลำโพงร่วมด้วย</p>
            </div>

            <div>
              <span className={L}>เลือกเสียงเตือน</span>
              <div className="grid gap-3 lg:grid-cols-2">
                {groups.map((g) => (
                  <div key={g.grp} className="grid content-start gap-1.5">
                    <small className="eas-grp">{g.grp}</small>
                    {g.items.map((s) => (
                      <div key={s.id} className={`eas-snd ${snd.soundId === s.id ? "is-on" : ""}`}>
                        <button type="button" className="eas-snd-pick" onClick={() => setS({ soundId: s.id })} aria-pressed={snd.soundId === s.id}>
                          <i aria-hidden />
                          <span>
                            <b>
                              {s.id}. {s.name}
                            </b>
                            <small>{s.desc}</small>
                          </span>
                        </button>
                        <button type="button" className={`eas-play ${playing === `s${s.id}` ? "is-on" : ""}`} aria-label={`ฟังเสียง ${s.name}`} onClick={() => play(`s${s.id}`, (sg) => playChime(s.id, snd.alarmVolume, sg))}>
                          {playing === `s${s.id}` ? "■" : "▶"}
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-end gap-3">
                <label className="min-w-[220px] flex-1">
                  <span className={L}>ประโยคสำเร็จรูป (เสียงผู้หญิง · มีไฟล์เสียงในระบบ)</span>
                  <select
                    className="field"
                    value={presetIdx}
                    onChange={(e) => {
                      const p = PRESETS[Number(e.target.value)];
                      if (p) setS({ msgTh: p.th, msgMy: p.my });
                    }}
                  >
                    {presetIdx < 0 && <option value={-1}>พิมพ์เอง</option>}
                    {PRESETS.map((p, i) => (
                      <option key={p.name} value={i}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="eas-range w-[200px]">
                  <span className={L}>ความเร็วพูด (เสียงอ่านของเบราว์เซอร์) {snd.voiceRate.toFixed(1)}</span>
                  <input type="range" min={0.5} max={1.5} step={0.1} value={snd.voiceRate} onChange={(e) => setS({ voiceRate: Number(e.target.value) })} />
                </label>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {(["th", "my"] as Lang[]).map((lang) => {
                  const st = voiceState(lang);
                  const text = lang === "th" ? snd.msgTh : snd.msgMy;
                  return (
                    <div key={lang} className={`eas-msg ${lang === "th" ? "is-th" : "is-my"}`}>
                      <div className="eas-msg-head">
                        <b>{lang === "th" ? "ประโยคที่ 1 : ภาษาไทย" : "ประโยคที่ 2 : ภาษาพม่า (พูดต่อทันที)"}</b>
                        {st && <span className={`eas-badge ${st.cls}`}>{st.label}</span>}
                      </div>
                      <textarea
                        className={`field ${lang === "my" ? "eas-my" : ""}`}
                        lang={lang}
                        rows={4}
                        maxLength={1000}
                        value={text}
                        onChange={(e) => setS(lang === "th" ? { msgTh: e.target.value } : { msgMy: e.target.value })}
                        placeholder={lang === "th" ? "พิมพ์ประโยคภาษาไทย" : "ว่าง = ไม่พูดประโยคที่ 2"}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={`fill-btn is-sm ${playing === lang ? "is-on" : ""}`}
                          disabled={!text.trim()}
                          onClick={() => play(lang, (sg) => speak({ text, lang, url: st?.url, rate: snd.voiceRate, volume: snd.voiceVolume }, sg))}
                        >
                          {playing === lang ? "■ หยุด" : "▶ ฟัง"}
                        </button>
                        <button
                          type="button"
                          className="fill-btn is-sm"
                          disabled={busy || !text.trim()}
                          onClick={() => {
                            upLang.current = lang;
                            fileRef.current?.click();
                          }}
                          title="อัพโหลดไฟล์เสียงของประโยคนี้ (.mp3 / .wav / .ogg / .m4a ไม่เกิน 3 MB)"
                        >
                          ⬆ อัพโหลดไฟล์เสียง
                        </button>
                        {st?.cls === "is-up" && (
                          <button type="button" className="fill-btn is-sm is-danger" onClick={() => deleteVoice(lang)}>
                            🗑 ลบไฟล์ที่อัพโหลด
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] font-semibold text-ink-soft">
                ไฟล์เสียงผูกกับข้อความ: แก้ประโยค = ระบบใช้เสียงอ่านของเบราว์เซอร์แทน (ใช้ Microsoft Edge + อินเทอร์เน็ต) จนกว่าจะอัพโหลดไฟล์เสียงของประโยคใหม่ · ประโยคพม่าที่ให้มาเป็นร่างแปล ควรให้คนพม่าตรวจก่อนใช้จริง
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".mp3,.wav,.ogg,.m4a,audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) uploadVoice(f);
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={`cta-btn ${playing === "all" ? "is-red" : "is-teal"}`} onClick={() => play("all", (sg) => playOnce({ ...snd, voiceTh: voiceState("th")?.url, voiceMy: voiceState("my")?.url }, sg))}>
                {playing === "all" ? "■ หยุด" : "▶ ทดสอบ 1 รอบ"}
              </button>
              <small className="text-[11px] font-semibold text-ink-soft">ทดสอบด้วยค่าที่ตั้งอยู่ (ยังไม่ต้อง SAVE)</small>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold text-ink-soft">{orig?.updatedBy ? `แก้ล่าสุด: ${orig.updatedBy}` : ""}</span>
        {dirty && <span className="text-xs font-bold text-warning">มีการเปลี่ยนแปลง - กด SAVE</span>}
        <button className="cta-btn is-green ml-auto" disabled={busy || !dirty} onClick={save}>
          {busy ? "…" : "💾 SAVE"}
        </button>
      </div>
    </div>
  );
}
