@echo off
rem Double-click: create a "CHR-Nexus" shortcut (with logo) on this computer's Desktop
set /p URL="CHR-Nexus link (Enter = http://localhost:3000): "
if "%URL%"=="" set URL=http://localhost:3000
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1" -Url "%URL%"
pause
