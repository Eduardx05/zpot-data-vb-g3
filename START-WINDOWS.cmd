@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Instala Node.js 20 o superior & pause & exit /b 1)
if not exist .env copy .env.example .env >nul
if not exist dist\server.js (
  call npm install || (pause & exit /b 1)
  call npm run build || (pause & exit /b 1)
)
echo.
echo Abre: http://127.0.0.1:8765
echo.
node dist\server.js
pause
