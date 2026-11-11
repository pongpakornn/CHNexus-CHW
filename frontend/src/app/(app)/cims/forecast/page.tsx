import { redirect } from "next/navigation";

// 📦 FORECAST / ORDER ย้ายไปอยู่ MASTER DATA (Sidebar กลาง) แล้ว · ลิงก์ / Bookmark เดิมพาไปหน้าใหม่
export default function Page() {
  redirect("/master/forecast");
}
