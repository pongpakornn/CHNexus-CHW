// ✍️ ไอคอนของปุ่ม APPROVE / REJECT: ชี้ที่ปุ่ม (className "act-draw") = เส้นติ๊ก / กากบาทถูกลากเขียนใหม่ แบบดินสอของปุ่ม EDIT
//   approve = ติ๊กถูก · reject = กากบาท (ลากเส้นแรก แล้วต่อเส้นที่สอง)
export function DrawIcon({ kind }: { kind: "approve" | "reject" }) {
  return (
    <svg viewBox="0 0 24 24" className={`di di-${kind}`} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {kind === "approve" ? (
        <path d="M4.5 12.5 9.5 17.5 19.5 6.5" className="di-p1" pathLength={1} />
      ) : (
        <>
          <path d="M6 6 18 18" className="di-p1" pathLength={1} />
          <path d="M18 6 6 18" className="di-p2" pathLength={1} />
        </>
      )}
    </svg>
  );
}
