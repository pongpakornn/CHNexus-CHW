"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

// ✍ ช่องพิมพ์แชท: ปุ่ม + แนบไฟล์ / รูป (ไม่เกิน 25 MB) · ตัวอย่างไฟล์ที่เลือก · Enter = ส่ง, Shift+Enter = ขึ้นบรรทัดใหม่
const MAX = 25 * 1024 * 1024;
const sizeText = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function ChatComposer({
  placeholder,
  disabled,
  allowFile = true,
  onTyping,
  onSend,
}: {
  placeholder: string;
  disabled?: boolean;
  allowFile?: boolean;
  onTyping?: () => void;
  onSend: (text: string, file: File | null) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // ตัวอย่างรูปที่เลือก
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) return;
    const u = URL.createObjectURL(file);
    const t = setTimeout(() => setPreview(u), 0);
    return () => {
      clearTimeout(t);
      URL.revokeObjectURL(u);
      setTimeout(() => setPreview(null), 0);
    };
  }, [file]);

  const pick = (f: File | null) => {
    setErr("");
    if (f && f.size > MAX) return setErr("ไฟล์ใหญ่เกิน 25 MB");
    setFile(f);
  };

  async function send() {
    const t = text.trim();
    if ((!t && !file) || busy || disabled) return;
    setBusy(true);
    try {
      if (await onSend(t, file)) {
        setText("");
        setFile(null);
        if (input.current) input.current.value = "";
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line/70 p-3">
      {(file || err) && (
        <div className="mb-2 flex items-center gap-2.5 rounded-2xl border border-line bg-surface-2 p-2">
          {err ? (
            <span className="px-1 text-xs font-bold text-danger">{err}</span>
          ) : (
            <>
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="size-12 rounded-xl object-cover" />
              ) : (
                <span className="grid size-12 place-items-center rounded-xl bg-white text-[#2563eb]">
                  <Icon name="document" className="size-6" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-extrabold text-ink">{file!.name}</span>
                <span className="block text-[11px] font-semibold text-ink-soft">{sizeText(file!.size)} · พิมพ์ข้อความประกอบได้ แล้วกดส่ง</span>
              </span>
            </>
          )}
          <button type="button" onClick={() => (setFile(null), setErr(""), input.current && (input.current.value = ""))} className="grid size-7 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-white hover:text-ink" aria-label="Remove file">
            <Icon name="xMark" className="size-4" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        {allowFile && (
          <>
            <input ref={input} type="file" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            {/* ➕ แนบไฟล์ / รูป */}
            <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="group mb-0.5 shrink-0 cursor-pointer outline-none duration-300 hover:rotate-90 disabled:cursor-not-allowed disabled:opacity-40" title="แนบไฟล์ / รูปภาพ">
              <svg className="fill-none stroke-teal-500 duration-300 group-hover:fill-teal-800 group-active:fill-teal-600 group-active:stroke-teal-200 group-active:duration-0" viewBox="0 0 24 24" height="34px" width="34px" xmlns="http://www.w3.org/2000/svg">
                <path strokeWidth="1.5" d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z" />
                <path strokeWidth="1.5" d="M8 12H16" />
                <path strokeWidth="1.5" d="M12 16V8" />
              </svg>
            </button>
          </>
        )}
        <div className="flex flex-1 items-end gap-2 rounded-2xl border border-line bg-surface px-3 py-2 transition focus-within:border-[#2563eb] focus-within:ring-2 focus-within:ring-[#2563eb]/15">
          <textarea
            rows={1}
            value={text}
            maxLength={2000}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value) onTyping?.();
            }}
            onPaste={(e) => {
              const f = e.clipboardData.files?.[0];
              if (f && allowFile) {
                e.preventDefault();
                pick(f);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={placeholder}
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13px] text-ink outline-none [field-sizing:content] disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || disabled || (!text.trim() && !file)}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-[#2563eb] text-white shadow-[0_6px_14px_-6px_rgba(37,99,235,.9)] transition hover:scale-105 hover:bg-[#1d4ed8] active:scale-95 disabled:scale-100 disabled:bg-line disabled:shadow-none"
            aria-label="Send"
          >
            {busy ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Icon name="send" className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
