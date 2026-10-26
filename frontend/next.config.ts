import type { NextConfig } from "next";
import { hostname, networkInterfaces } from "node:os";

// API (ASP.NET) ฝั่ง Server - Browser เรียก /api/* ที่ Next แล้ว Next ส่งต่อ (Cookie Login อยู่โดเมนเดียวกัน)
const API_URL = process.env.API_URL ?? "http://localhost:5080";

// 🌐 npm run dev แล้วเปิดจากเครื่องอื่นในวง LAN ได้: อนุญาต IP / ชื่อเครื่องนี้ (+ DEV_ORIGINS เพิ่มเองคั่นด้วย ,)
const devOrigins = [
  hostname(),
  ...Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address),
  ...(process.env.DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
];

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  // ป้าย "N / Insight" มุมจอของ Next.js (แสดงเฉพาะตอน npm run dev) - ปิดไว้ไม่ให้ผู้ใช้เห็น · Error จริงยังแสดงตามปกติ
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
