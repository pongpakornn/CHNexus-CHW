// 💬 เปิดแชทจากที่ไหนก็ได้ (ปุ่มหูฟัง / เมนูโปรไฟล์ / กระดิ่ง / Toast) - SupportChat ใน Shell รับ Event นี้
export const SUPPORT_EVENT = "nexus:support";
// ให้กระดิ่งโหลดใหม่ทันที (มีข้อความใหม่ / ส่งข้อความแล้ว)
export const NOTIFY_REFRESH = "nexus:notify-refresh";

export type SupportOpen = { tab?: "support" | "chat"; threadId?: number; chatWith?: string };

/** แจ้ง Admin (threadId = เปิดเรื่องนั้น) */
export function openSupport(threadId?: number) {
  window.dispatchEvent(new CustomEvent<SupportOpen>(SUPPORT_EVENT, { detail: { tab: "support", threadId } }));
}

/** แชทระหว่างผู้ใช้ (chatWith = UserID ของคู่สนทนา) */
export function openChat(chatWith?: string) {
  window.dispatchEvent(new CustomEvent<SupportOpen>(SUPPORT_EVENT, { detail: { tab: "chat", chatWith } }));
}

/** บทสนทนาที่เปิดอยู่ตอนนี้ (DirectChat / SupportChat เป็นคนตั้ง) - ChatFeed ไม่เด้ง Toast ซ้ำของห้องนั้น */
export const chatView: { dm: string | null; sup: number | null } = { dm: null, sup: null };

export function refreshNotifications() {
  window.dispatchEvent(new Event(NOTIFY_REFRESH));
}

export type SupportTopic = "PROBLEM" | "UPDATE" | "PERMISSION";

export const TOPICS: { value: SupportTopic; label: string; emoji: string; color: string }[] = [
  { value: "PROBLEM", label: "รายงานปัญหาการใช้งานระบบ", emoji: "🛠️", color: "#ef4444" },
  { value: "UPDATE", label: "แจ้งอัพเดทระบบ", emoji: "🚀", color: "#2563eb" },
  { value: "PERMISSION", label: "ขอสิทธิ์การใช้งานระบบ", emoji: "🔐", color: "#8b5cf6" },
];

export const topicOf = (v: string) => TOPICS.find((t) => t.value === v) ?? { value: v as SupportTopic, label: v, emoji: "💬", color: "#64748b" };
