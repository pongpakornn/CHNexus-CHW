@echo off
rem Double-click: create a "CHR-Nexus" shortcut (with logo) on this computer's Desktop
set /p URL="CHR-Nexus link (Enter = http://192.168.10.56:3003): "
if "%URL%"=="" set URL=http://192.168.10.56:3003
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1" -Url "%URL%"
pause
