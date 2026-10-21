# CHR-NEXUS

<img src="frontend/public/icons/app-192.png" alt="CHR-Nexus" width="72" align="right" />

ระบบ ERP : องค์กรปัจจุบัน เพื่อพัฒนาระบบการทำงานให้มีประสิทธิภาพเเละออกแบบมาให้เพื่อให้ผู้ใช้งานสามารถทำงานได้ง่ายมากยิ่งขึ้นจัดการข้อมูลออกแบบข้อมูลเเละลดเวลาในการทำงาน เพิ่มประสิทธิภาพในการทำงาน เสริมการพัฒนาระบบ ที่ไม่เคยมีใช้งานให้มีระบบเข้ามาช่วยจัดการเเละ Control ดำเนินการได้อย่างมีประสิทธิภาพมากยิ่งขึ้น

**ระบบกลาง CHR-Nexus** เริ่มจากระบบ Stock: ย้ายทุกฟังก์ชันของโปรแกรม WPF **CIMS - Inventory Management**
([CIMS-InventoryManagement](https://github.com/pongpakornn/CIMS-InventoryManagement)) มาเป็น Web App ใช้งานได้ทุกขนาดจอ (Windows / Mac / มือถือ)
— **เงื่อนไขการทำงานเดิมทุกข้อ** (ไฟล์ Service เดิมย้ายมาทั้งชุด)

| ส่วน | เทคโนโลยี | โฟลเดอร์ |
|---|---|---|
| Frontend | Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 | `frontend/` |
| Backend API | ASP.NET Core (.NET 10) + Dapper / SqlClient | `backend/CHR.Nexus.Api/` |
| Database | SQL Server `192.168.10.56` → ฐาน **`CHR-Nexus`** schema `Nexus` (สร้างจาก `CIMS`) | `database/` |

## โครงสร้าง Backend

- `Legacy/` = โค้ดจากโปรแกรม CIMS (Services / Models / Helpers) namespace `Nexus.*` — แก้เฉพาะส่วนที่เป็น WPF
  (รูปภาพ, เปิดไฟล์, ชื่อเครื่อง) เพื่อให้กฎ / ข้อความ / SQL เหมือนเดิมทุกอย่าง
- `Web/` = ส่วนของเว็บ: Login (JWT ใน Cookie HttpOnly), ผู้ใช้ต่อ Request, ตัวประมวลผลสแกน (`Web/Scanner/ScanProcessor.cs` = `ScanInViewModel.ProcessScan` เดิม)
- `Controllers/` = API

## เริ่มใช้งาน (เครื่อง Dev)

```bash
npm run dev      # รันจากโฟลเดอร์ไหนก็ได้ในโปรเจค (root / frontend / backend)
```

เปิด API (ASP.NET :5080) + Web (Next.js :3000) พร้อมกันในคำสั่งเดียว — Ctrl+C ปิดทั้งคู่
- ครั้งแรกติดตั้ง `frontend/node_modules` ให้เอง / API เปิดอยู่แล้ว (เช่นใน Visual Studio) = ใช้ตัวนั้น
- เครื่องอื่นในวง LAN เปิดได้ที่ `http://<IP เครื่องนี้>:3000` (หน้าจอแสดง IP ให้ตอนเริ่ม)
  ถ้าเครื่องอื่นเปิดไม่ได้ = Windows Firewall บล็อกพอร์ต 3000 ให้อนุญาต (PowerShell แบบ Admin):
  `New-NetFirewallRule -DisplayName "CHR-Nexus Dev 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Domain,Private`
- รันแยกได้: `npm run dev:web` / `npm run dev:api`

**เครื่องใหม่** (ต้องมี Node.js 20.9+ และ .NET 10 SDK) ตั้งค่าครั้งเดียว — ค่าจริงเก็บใน user-secrets ไม่ขึ้น GitHub:

```bash
cd backend/CHR.Nexus.Api
dotnet user-secrets set "ConnectionStrings:Main" "Server=192.168.10.56; Database=CHR-Nexus; User ID=...; Password=...; TrustServerCertificate=True;"
dotnet user-secrets set "Jwt:Key" "<สุ่มอย่างน้อย 32 ตัวอักษร>"
```

Server จริง: ใช้ `appsettings.Local.json` หรือ Environment Variables (`ConnectionStrings__Main`, `Jwt__Key`) และตั้ง `API_URL` ให้ Frontend

## 🔒 แยกจากระบบที่ใช้งานจริง

- API **ไม่ยอมเริ่มทำงาน** ถ้า `ConnectionStrings:Main` ไม่ใช่ฐาน `CHR-Nexus` — ห้ามแตะฐาน `CIMS` ของระบบจริง
- **ERP `192.168.10.10` = อ่านอย่างเดียว** (ยืมข้อมูลมาแสดง / ปริ้น Pick List) ทุกคำสั่งผ่าน `ErpReadOnly`: SELECT เท่านั้น + Rollback ทุกครั้ง
  แนะนำให้ใช้ Login ของ ERP ที่มีสิทธิ์แค่ `db_datareader` ตั้งค่าเอง (ห้ามใส่รหัสผ่านในไฟล์ที่ขึ้น GitHub):
  `dotnet user-secrets set "ConnectionStrings:Erp" "Server=192.168.10.10; Database=CHR; User ID=...; Password=...; TrustServerCertificate=True;"`
  ไม่ตั้ง = หน้า Pick List อ่านประวัติจากตาราง `Nexus.PickListPrintLogs` ใน CHR-Nexus
- **StorePC = อ่านอย่างเดียว** คลัง STORE-PC แสดงข้อมูลสดจากฐาน StorePC (`Nexus.vw_StorePcLive`) แก้ / สแกน / Import ไม่ได้
- รูปสินค้า / ไฟล์ Excel (PR / RPA / Forecast) อยู่ที่ `storage/` ของโปรเจค (ไม่ขึ้น GitHub)
  รูปที่ไม่มีใน `storage/` อ่านจากโฟลเดอร์รูปเดิมของ WPF แบบอ่านอย่างเดียว (`Storage:ImageFallback`) — อัปโหลดรูปจากเว็บเขียนลง `storage/` เสมอ
  ไฟล์ Excel ของ EXCEL SETUP อัปโหลดจากหน้า User Management → ⚙ SETUP → EXCEL SETUP → UPLOAD
- **เขียน Excel ที่ Path ตรงๆ เหมือน WPF:** ใส่โฟลเดอร์ที่อนุญาตใน `Storage:DirectExcelRoots` (user-secrets / appsettings.Local.json)
  Path ใน EXCEL SETUP ที่อยู่ใต้โฟลเดอร์เหล่านี้จะถูกเขียนตรงที่ไฟล์นั้น นอกนั้นยังอยู่ใน `storage/excel`
  ⚠️ ถ้าใส่โฟลเดอร์ของบอท RPA จริง ข้อมูลทดสอบจะไปถึงบอทด้วย — ช่วงทดสอบให้ใช้โฟลเดอร์สำเนา
- ไฟล์ Export / Template สร้างในโฟลเดอร์ชั่วคราวของ Server แล้วดาวน์โหลดผ่าน Browser

## Database

- **สร้างฐาน `CHR-Nexus`**: เปิด `database/nexus/01_Create_CHR-Nexus.sql` ใน SSMS (Login sysadmin บน .56) แล้ว Execute ครั้งเดียว
  1. `BACKUP DATABASE [CIMS] ... WITH COPY_ONLY` (อ่าน CIMS อย่างเดียว ไม่กระทบระบบที่ใช้งาน / ลำดับ Backup ปกติ)
  2. `RESTORE` เป็น `[CHR-Nexus]` → ได้ข้อมูล + การตั้งค่าทั้งหมดของ CIMS ณ เวลาที่รัน
     (คลัง, Store Max-Min, Multi-Scanner, Barcode Format, Product Control, PR / Excel Setup / RPA Layout, สูตร Max-Min, วันทำงาน, Users / Permission)
  3. เปลี่ยน schema `CIMS` → `Nexus` (ตาราง / View / Procedure / Function / Trigger)
- `database/legacy/` = Script อัพเดทฐานข้อมูลของ CIMS เดิม (ชื่อ schema `CIMS`) เก็บไว้เป็นประวัติ — ฐาน CHR-Nexus สร้างจาก CIMS ที่อัพเดทครบแล้ว
- ฐาน `CHR-Synchron` (ชื่อเดิมของโปรเจคนี้) ไม่ใช้แล้ว — ลบได้เมื่อ CHR-Nexus ใช้งานได้ (ขั้นที่ 4 ในไฟล์ Script)

## โลโก้ / Shortcut บน Desktop

- โลโก้ระบบ: `frontend/src/app/favicon.ico`, `icon.png`, `apple-icon.png`, `frontend/public/icons/app-192.png`, `app-512.png`, `logo.png`
- **Windows**: ดับเบิลคลิก `scripts/create-shortcut.cmd` แล้วใส่ Link ของระบบ → ได้ Shortcut "CHR-Nexus" พร้อมโลโก้บน Desktop
  หรือเปิดระบบใน Chrome / Edge → เมนู ⋮ → Cast, save and share → **Install page as app / Create shortcut** (ใช้โลโก้จาก Manifest)
- **Mac**: Safari → File → **Add to Dock** / Chrome → Install (ใช้โลโก้ `apple-icon.png`)

## สถานะการย้ายหน้าจอ

| หน้า | สถานะ |
|---|---|
| Login / สิทธิ์ (Level + Permissions เดิม) / Sidebar / Activity Log การเปิดหน้า | ✅ |
| **Dashboard** — การ์ด 4 ใบแยกคลัง (อัพเดททุก 3 วินาที) + Order ลูกค้าเดือนนี้ + Forecast / Order / Delivery ทั้งปี | ✅ |
| **Store (Max-Min)** — การ์ดคลัง / ตาราง / ตั้งค่าคลัง / Barcode Formats / Import-Export | ✅ |
| **Multi-Scanner** — IN / OUT / RETURN / REMAINDER / TEST, หลายคลัง + AUTO + ★, EMPLOYEE ID / DEPARTMENT, ทะเบียน Coil, DEDUCTED / NOT DEDUCTED (APPROVE), ADJUST SCAN, DISPLAY, HISTORY + EXPORT + **EXPORT RPA** | ✅ |
| **Inventory Registration** — ลงทะเบียน / แก้ไข / Import / QR / Admin | ✅ |
| **Pick List** | ✅ |
| **Max-Min Calculator** — สูตร (FORMULAS) / AUTO CALC ต่อคลัง / MAX-MIN (DAYS) ต่อสินค้า / RESET / วันทำงานลูกค้า (ปฏิทิน 12 เดือน) / Template / IMPORT SET MAX MIN / IMPORT FORECAST & ORDER / CALCULATE NOW | ✅ |
| **Forecast / Order / Delivery** — กราฟทั้งปี + TOP 5 / ตารางตามเดือน / Import (คำนวณ AUTO หรือ IMPORT อย่างเดียว) / Template / Export | ✅ |
| **PR Management** | ✅ |
| **Activity Log** — ค้นหา / กรอง / Export | ✅ |
| **User Management** — การ์ดผู้ใช้ / เพิ่ม-แก้-ลบ / 🔑 PERMISSION + คลังสแกน / ALERT CONTACT / Import-Template / ⚙ SETUP (PR SETTINGS, EXCEL SETUP PR + RPA, DEPARTMENTS) | ✅ |

ทุกหน้าอัพเดทแบบเรียลไทม์ (ตรวจการเปลี่ยนแปลงในฐานข้อมูลเป็นรอบ ๆ แบบโปรแกรมเดิม) และโหลดตารางทีละช่วงตอนเลื่อน เพื่อไม่ให้หน้าค้าง

## License

Copyright © 2026 Non-Pongpakorn Urang. All Rights Reserved.
