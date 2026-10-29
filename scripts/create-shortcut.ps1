# สร้าง Shortcut "CHR-Nexus" บน Desktop ของเครื่องผู้ใช้ (Windows) พร้อมโลโก้ระบบ
#   ใช้: ดับเบิลคลิก scripts\create-shortcut.cmd  หรือ
#        powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1 -Url http://<IP เครื่องที่รันระบบ>:3000
#   โลโก้ดาวน์โหลดจากระบบ (<Url>/favicon.ico) มาเก็บที่ %LocalAppData%\CHR-Nexus\chr-nexus.ico
param(
    [string]$Url = "http://192.168.10.56:3003",
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

# ตั้งชื่อไฟล์ไอคอนตามเนื้อไฟล์ (โลโก้เปลี่ยน = ชื่อไฟล์เปลี่ยน) - Windows จำไอคอนตามชื่อไฟล์ ถ้าใช้ชื่อเดิมจะยังโชว์โลโก้เก่า
if (Test-Path $ico) {
    $tag = (Get-FileHash $ico -Algorithm MD5).Hash.Substring(0, 8).ToLower()
    $named = Join-Path $dir "chr-nexus-$tag.ico"
    Move-Item $ico $named -Force
    Get-ChildItem $dir -Filter "chr-nexus-*.ico" | Where-Object { $_.FullName -ne $named } | Remove-Item -Force -ErrorAction SilentlyContinue
    $ico = $named
}

$desktop = [Environment]::GetFolderPath("Desktop")
$path = Join-Path $desktop "$Name.url"
$lines = @("[InternetShortcut]", "URL=$Url/")
if (Test-Path $ico) { $lines += @("IconFile=$ico", "IconIndex=0") }
Set-Content -Path $path -Value $lines -Encoding ASCII
Write-Output "สร้าง Shortcut แล้ว: $path -> $Url/"
