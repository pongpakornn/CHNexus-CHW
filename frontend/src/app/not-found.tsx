import Link from "next/link";

// 404: a mistyped / old link lands here instead of the bare default page
export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md rounded-[26px] bg-surface p-7 text-center shadow-[0_30px_70px_-30px_rgb(20_20_50/0.45)]">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#ede9fe] text-2xl font-extrabold text-accent">?</div>
        <h1 className="mt-4 text-lg font-extrabold uppercase tracking-wide text-primary">ไม่พบหน้านี้</h1>
        <p className="mt-2 text-sm font-semibold text-ink-soft">ลิงก์อาจพิมพ์ผิดหรือหน้านี้ถูกย้ายแล้ว - กลับหน้าหลักเพื่อเลือกระบบที่ต้องการ</p>
        <div className="mt-5 flex justify-center">
          <Link href="/" className="cta-btn is-purple">
            กลับหน้าหลัก
          </Link>
        </div>
      </div>
    </div>
  );
}
