# สร้าง Shortcut "CHR-Nexus" บน Desktop ของเครื่องผู้ใช้ (Windows) พร้อมโลโก้ระบบ
#   ใช้: ดับเบิลคลิก scripts\create-shortcut.cmd  หรือ
#        powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1 -Url http://<IP เครื่องที่รันระบบ>:3000
#   โลโก้ดาวน์โหลดจากระบบ (<Url>/favicon.ico) มาเก็บที่ %LocalAppData%\CHR-Nexus\chr-nexus.ico
param(
    [string]$Url = "http://localhost:3000",
    [string]$Name = "CHR-Nexus"
)
$ErrorActionPreference = "Stop"
$Url = $Url.TrimEnd("/")

$dir = Join-Path $env:LOCALAPPDATA "CHR-Nexus"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$ico = Join-Path $dir "chr-nexus.ico"
try {
    Invoke-WebRequest -Uri "$Url/favicon.ico" -OutFile $ico -UseBasicParsing
} catch {
    # เปิดระบบไม่ได้ตอนนี้ -> ใช้ไฟล์โลโก้ในโปรเจค (ถ้ารันจากโฟลเดอร์โปรเจค)
    $local = Join-Path $PSScriptRoot "..\frontend\src\app\favicon.ico"
    if (Test-Path $local) { Copy-Item $local $ico -Force } else { Write-Warning "ดาวน์โหลดโลโก้ไม่ได้ ($Url) - Shortcut จะใช้ไอคอนของ Browser" }
}

$desktop = [Environment]::GetFolderPath("Desktop")
$path = Join-Path $desktop "$Name.url"
$lines = @("[InternetShortcut]", "URL=$Url/")
if (Test-Path $ico) { $lines += @("IconFile=$ico", "IconIndex=0") }
Set-Content -Path $path -Value $lines -Encoding ASCII
Write-Output "สร้าง Shortcut แล้ว: $path -> $Url/"
