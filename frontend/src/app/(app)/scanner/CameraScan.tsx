"use client";

import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

// 📷 สแกน QR / บาร์โค้ดด้วยกล้องมือถือ (Multi-Scanner) - อ่านได้ = ส่งเหมือนยิงจากเครื่องสแกน (commit)
//   สแกนต่อเนื่อง (รหัสเดิมซ้ำภายใน 2 วินาที = ไม่ส่งซ้ำ) · กล้องใช้ไม่ได้ (http / ไม่อนุญาตกล้อง) = ถ่ายรูปแล้วอ่านจากรูปแทน
export function CameraScan({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const last = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"starting" | "live" | "nocam">("starting");
  const [hit, setHit] = useState<{ text: string; n: number } | null>(null);
  const [msg, setMsg] = useState("");
  const cb = useRef(onResult);
  useEffect(() => {
    cb.current = onResult;
  }, [onResult]);

  const got = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const now = Date.now();
    if (t === last.current.text && now - last.current.at < 2000) return;
    last.current = { text: t, at: now };
    navigator.vibrate?.(60);
    setHit((h) => ({ text: t, n: (h?.n ?? 0) + 1 }));
    cb.current(t);
  };

  useEffect(() => {
    let stop = false;
    (async () => {
      // กล้องต้องเปิดผ่าน https หรือ localhost เท่านั้น
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setState("nocam");
        setMsg("เปิดกล้องได้เฉพาะเว็บที่เป็น https - ใช้ปุ่มถ่ายรูปด้านล่างแทนได้");
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (stop) return;
        const reader = new BrowserMultiFormatReader();
        controls.current = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video.current!, (res) => res && got(res.getText()));
        if (stop) controls.current.stop();
        else setState("live");
      } catch (e) {
        setState("nocam");
        setMsg((e as Error).name === "NotAllowedError" ? "ไม่ได้อนุญาตให้ใช้กล้อง - เปิดสิทธิ์กล้องในเบราว์เซอร์ หรือใช้ปุ่มถ่ายรูป" : "เปิดกล้องไม่ได้ - ใช้ปุ่มถ่ายรูปแทน");
      }
    })();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      stop = true;
      controls.current?.stop();
      window.removeEventListener("keydown", esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ถ่ายรูป / เลือกรูป -> อ่าน QR / บาร์โค้ดจากรูป (ใช้ได้ทั้ง http)
  async function fromPhoto(file: File) {
    setMsg("กำลังอ่านรูป...");
    const url = URL.createObjectURL(file);
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const r = await new BrowserMultiFormatReader().decodeFromImageUrl(url);
      setMsg("");
      got(r.getText());
    } catch {
      setMsg("ไม่พบ QR / บาร์โค้ดในรูป - ถ่ายให้ใกล้และชัดขึ้น");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div className="cam-bg" role="dialog" aria-label="สแกนด้วยกล้อง">
      <div className="cam-top">
        <b>📷 SCAN QR / BARCODE</b>
        <button type="button" className="cam-x" onClick={onClose} aria-label="ปิด">
          ✕
        </button>
      </div>
      <div className="cam-view">
        <video ref={video} className={`cam-video ${state === "live" ? "" : "opacity-0"}`} muted playsInline />
        <div className={`cam-frame ${hit ? "is-hit" : ""}`} key={hit?.n ?? 0}>
          <i />
          <i />
          <i />
          <i />
          {state === "live" && <span className="cam-line" />}
        </div>
        {state === "starting" && <div className="cam-note">กำลังเปิดกล้อง...</div>}
        {state === "nocam" && <div className="cam-note">{msg}</div>}
      </div>
      <div className="cam-bottom">
        {hit && (
          <div key={hit.n} className="cam-hit">
            ✓ {hit.text}
          </div>
        )}
        {state === "live" && msg && <div className="text-xs font-bold text-white/70">{msg}</div>}
        <p className="text-xs font-semibold text-white/70">เล็ง QR / บาร์โค้ดให้อยู่ในกรอบ - อ่านได้ระบบบันทึกให้ทันทีเหมือนยิงเครื่องสแกน</p>
        <div className="flex gap-2">
          <button type="button" className="cta-btn is-purple" onClick={() => fileRef.current?.click()}>
            📸 ถ่ายรูป / เลือกรูป
          </button>
          <button type="button" className="cta-btn is-gray" onClick={onClose}>
            CLOSE
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) fromPhoto(f);
          }}
        />
      </div>
    </div>
  );
}
