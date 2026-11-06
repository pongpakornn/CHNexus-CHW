// ✍ เปิดเอกสาร MIN REPORT ใบเดียว (ดู + ลงลายเซ็นช่องของตัวเอง) จากที่ไหนก็ได้: กระดิ่ง / Toast / การ์ดในแชท / ประวัติ
//   MinSignHost ใน Shell รับ Event นี้
export const MIN_SIGN_EVENT = "nexus:minsign";
// รูปแบบในข้อความแชท: [[MINREPORT:123]] -> การ์ดปุ่มเปิดเอกสาร
export const MIN_TOKEN = /\[\[MINREPORT:(\d+)\]\]/;

export function openMinSign(reportId: number) {
  window.dispatchEvent(new CustomEvent<number>(MIN_SIGN_EVENT, { detail: reportId }));
}

/** แยกข้อความแชทกับเลขรายงาน (ไม่มี = null) */
export function minTokenOf(body: string): { text: string; id: number } | null {
  const m = MIN_TOKEN.exec(body ?? "");
  return m ? { text: body.replace(MIN_TOKEN, "").trim(), id: Number(m[1]) } : null;
}
