"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { api, upload } from "@/lib/api";

// ✍ ลายเซ็นของฉัน: วาดด้วยเมาส์ / นิ้ว หรืออัปโหลดรูป -> แปลงเป็น PNG พื้นใส (ตัดขอบว่าง) -> บันทึกเป็น <UserID>-Signature.png
//   ใช้ลงช่อง Prepared / Checked / Checked / Approved ของเอกสาร MIN REPORT
type Me = { has: boolean; updated: string | null; file: string };
const W = 640,
  H = 240;

// ทำพื้นขาวให้ใส + ตัดขอบว่างรอบลายเซ็น (ใช้ได้ทั้งลายเซ็นที่วาดและรูปที่สแกนมา)
function toPng(src: HTMLCanvasElement): Promise<Blob | null> {
  const ctx = src.getContext("2d")!;
  const img = ctx.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  let x0 = src.width,
    y0 = src.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      const light = d[i] > 225 && d[i + 1] > 225 && d[i + 2] > 225;
      if (light) d[i + 3] = 0;
      if (d[i + 3] > 20) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  if (x1 < 0) return Promise.resolve(null);
  ctx.putImageData(img, 0, 0);
  const pad = 6;
  const out = document.createElement("canvas");
  out.width = Math.min(src.width, x1 - x0 + pad * 2);
  out.height = Math.min(src.height, y1 - y0 + pad * 2);
  out.getContext("2d")!.drawImage(src, Math.max(0, x0 - pad), Math.max(0, y0 - pad), out.width, out.height, 0, 0, out.width, out.height);
  return new Promise((r) => out.toBlob(r, "image/png"));
}

export function SignatureModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const toast = useToast();
  const cv = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [ver, setVer] = useState(0);
  const [inked, setInked] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<Me>("/signature/me")
      .then(setMe)
      .catch(() => setMe({ has: false, updated: null, file: "" }));
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const clear = () => {
    const c = cv.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setInked(false);
  };
  const pos = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const down = (e: React.PointerEvent) => {
    drawing.current = true;
    last.current = pos(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const p = pos(e);
    const ctx = cv.current!.getContext("2d")!;
    ctx.strokeStyle = "#1a237e";
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!inked) setInked(true);
  };
  const up = () => {
    drawing.current = false;
    last.current = null;
  };

  // อัปโหลดรูป -> วาดลง Canvas (ย่อพอดี) แล้วใช้ขั้นตอนเดียวกับการวาด
  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|bmp)$/.test(f.type)) return toast.show("WARNING", "รองรับรูป PNG / JPG / WEBP / BMP", "warn");
    if (f.size > 8 * 1024 * 1024) return toast.show("WARNING", "รูปใหญ่เกิน 8 MB", "warn");
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      clear();
      const s = Math.min(W / img.width, H / img.height, 1);
      const w = img.width * s,
        h = img.height * s;
      cv.current!.getContext("2d")!.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      URL.revokeObjectURL(url);
      setInked(true);
    };
    img.src = url;
  }

  async function save() {
    if (!cv.current || !inked) return toast.show("WARNING", "กรุณาวาดลายเซ็น หรืออัปโหลดรูปก่อน", "warn");
    setBusy(true);
    try {
      const blob = await toPng(cv.current);
      if (!blob) throw new Error("ไม่พบเส้นลายเซ็น");
      const r = await upload<{ message: string }>("/signature", new File([blob], `${userId}-Signature.png`, { type: "image/png" }));
      toast.show("SIGNATURE", r.message, "ok");
      clear();
      setVer((v) => v + 1);
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/signature", { method: "DELETE" });
      toast.show("SIGNATURE", r.message, "ok");
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      title="✍ ลายเซ็นของฉัน"
      onClose={onClose}
      footer={
        <>
          {me?.has && (
            <button className="cta-btn is-red is-sm mr-auto" onClick={remove} disabled={busy}>
              🗑 ลบลายเซ็น
            </button>
          )}
          <button className="cta-btn is-gray" onClick={onClose}>
            CLOSE
          </button>
          <button className="cta-btn is-green" onClick={save} disabled={busy || !inked}>
            {busy ? "…" : "💾 บันทึกลายเซ็น"}
          </button>
        </>
      }
    >
      <div className="sig-wrap">
        <div className="sig-now">
          <small>ลายเซ็นปัจจุบัน</small>
          {me?.has ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/signature/${encodeURIComponent(userId)}/image?v=${ver}-${me.updated ?? ""}`} alt="ลายเซ็นปัจจุบัน" draggable={false} />
              <span>
                {me.file} · อัพเดท {me.updated ? new Date(me.updated).toLocaleString("th-TH") : "-"}
              </span>
            </>
          ) : (
            <span className="sig-none">ยังไม่มีลายเซ็น — วาดหรืออัปโหลดด้านล่าง แล้วกดบันทึก</span>
          )}
        </div>
        <div className="sig-pad">
          <canvas
            ref={cv}
            width={W}
            height={H}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            aria-label="ช่องวาดลายเซ็น"
          />
          {!inked && <span className="sig-hint">✍ วาดลายเซ็นที่นี่ (เมาส์ / นิ้ว / ปากกา)</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="cta-btn is-gray is-sm" onClick={clear}>
            ↺ ล้าง
          </button>
          <button type="button" className="cta-btn is-purple is-sm" onClick={() => fileRef.current?.click()}>
            📁 อัปโหลดรูปลายเซ็น
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden onChange={(e) => (pickFile(e.target.files?.[0]), (e.target.value = ""))} />
          <span className="text-xs font-semibold text-ink-soft">บันทึกเป็น {userId}-Signature.png (พื้นใส · ตัดขอบอัตโนมัติ) · ใช้ลงลายเซ็นเอกสาร MIN REPORT</span>
        </div>
      </div>
    </Modal>
  );
}
