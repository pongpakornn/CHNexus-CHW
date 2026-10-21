import type { MetadataRoute } from "next";

// ติดตั้งเป็นแอป / สร้าง Shortcut จาก Chrome / Edge / Safari = ใช้ชื่อและโลโก้ CHR-Nexus
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CHR-Nexus",
    short_name: "CHR-Nexus",
    description: "CHR-Nexus - ระบบกลางของ CHR (Inventory Management)",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#1c1c1e",
    icons: [
      { src: "/icons/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/app-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
