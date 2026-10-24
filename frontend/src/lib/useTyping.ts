"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

// ⌨ กำลังพิมพ์: notify() = บอกอีกฝั่งว่าฉันกำลังพิมพ์ (ส่งไม่เกินทุก 2 วินาที) · typing = อีกฝั่งกำลังพิมพ์ (เช็กทุก 1.5 วินาที)
//   url = null -> ปิด (ยังไม่ได้เลือกห้อง)
export function useTyping(url: string | null) {
  const [typing, setTyping] = useState(false);
  const lastSent = useRef(0);

  useEffect(() => {
    if (!url) return;
    let stop = false;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      api<{ typing: boolean }>(url)
        .then((r) => !stop && setTyping(r.typing))
        .catch(() => {});
    };
    const first = setTimeout(check, 0);
    const t = setInterval(check, 1500);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(t);
      setTimeout(() => setTyping(false), 0);
    };
  }, [url]);

  const notify = useCallback(() => {
    if (!url) return;
    const now = Date.now();
    if (now - lastSent.current < 2000) return;
    lastSent.current = now;
    api(url, { method: "POST" }).catch(() => {});
  }, [url]);

  return { typing: !!url && typing, notify };
}
