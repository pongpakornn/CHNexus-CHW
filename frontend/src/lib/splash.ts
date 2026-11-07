// 🚀 ให้ Splash Screen รอข้อมูลนี้ก่อนเปิดหน้าจริง (ไม่มี splash / แสดงไปแล้ว = ไม่มีผล คืน Promise เดิม)
type SplashApi = { wait: <T>(p: Promise<T>) => Promise<T> };

export function splashWait<T>(p: Promise<T>): Promise<T> {
  const s = (window as Window & { CHRSplash?: SplashApi }).CHRSplash;
  return s ? s.wait(p) : p;
}
