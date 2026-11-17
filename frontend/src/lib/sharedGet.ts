import { api } from "./api";

// GET ที่หลายคอมโพเนนต์ในแท็บเดียวกันขอพร้อมกัน (สัญญาณ live ปลุกทุกตัวพร้อมกัน) = ยิงจริงครั้งเดียว แล้วแบ่งผลกัน
// เฉพาะคำขอที่เริ่มไม่เกิน 500 ms (ไม่เอาผลเก่ามาใช้หลังมีการบันทึก)
const inflight = new Map<string, { at: number; p: Promise<unknown> }>();

export function sharedGet<T>(path: string): Promise<T> {
  const hit = inflight.get(path);
  if (hit && Date.now() - hit.at < 500) return hit.p as Promise<T>;
  const p = api<T>(path);
  const e = { at: Date.now(), p };
  inflight.set(path, e);
  const clear = () => {
    if (inflight.get(path) === e) inflight.delete(path);
  };
  p.then(clear, clear);
  return p;
}
