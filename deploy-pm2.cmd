@echo off
setlocal
rem CHR-Nexus deploy: web 3003 / api 5004 on pm2 (touches only chr-nexus-web, chr-nexus-api)
rem Heavy work runs while the old apps keep serving: web is down only during next build, api only during the file swap
cd /d "%~dp0"
set API_URL=http://localhost:5004
set PUB=backend\CHR.Nexus.Api\publish
set STAGE=backend\_publish-new

echo [1/7] Publish API to staging (old API keeps running)...
if exist "%STAGE%" rmdir /s /q "%STAGE%"
dotnet publish backend\CHR.Nexus.Api -c Release -o "%STAGE%" || goto :err

echo [2/7] Web packages...
pushd frontend
set NEEDCI=
fc /b package-lock.json node_modules\.deploy-lock >nul 2>&1 || set NEEDCI=1
if defined NEEDCI (
  echo        package-lock.json changed - stop web and run npm ci
  call pm2 stop chr-nexus-web >nul 2>&1
  call npm ci || goto :errpop
  copy /y package-lock.json node_modules\.deploy-lock >nul
) else (
  echo        package-lock.json unchanged - skip npm ci
)

echo [3/7] Build web (web is down until the build finishes)...
rem next build clears .next, so the running web must stop first
call pm2 stop chr-nexus-web >nul 2>&1
call npm run build || goto :errpop
popd
call pm2 startOrRestart ecosystem.config.js --only chr-nexus-web --update-env || goto :err

echo [4/7] Swap API files...
call pm2 stop chr-nexus-api >nul 2>&1
rem /E keeps files that exist only in publish (appsettings.Production.json)
robocopy "%STAGE%" "%PUB%" /E /R:5 /W:2 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :err
rmdir /s /q "%STAGE%"

set CFG=%PUB%\appsettings.Production.json
if not exist "%CFG%" (
  echo [5/7] Fill in Main connection string, Jwt.Key ^(32+ chars^), Cors.Origins = http://192.168.10.56:3003 then SAVE and close Notepad
  copy backend\CHR.Nexus.Api\appsettings.json "%CFG%" >nul
  start /wait notepad "%CFG%"
) else (
  echo [5/7] appsettings.Production.json exists - keep
)

echo [6/7] Start API + pm2 save...
call pm2 startOrRestart ecosystem.config.js --only chr-nexus-api --update-env || goto :err
call pm2 save

echo [7/7] Firewall port 3003...
netsh advfirewall firewall show rule name="CHR-Nexus Web 3003" >nul 2>&1 || netsh advfirewall firewall add rule name="CHR-Nexus Web 3003" dir=in action=allow protocol=TCP localport=3003

call pm2 ls
echo DONE - open http://192.168.10.56:3003
pause
exit /b 0

:errpop
popd
:err
echo FAILED - see error above
call pm2 ls
pause
exit /b 1
