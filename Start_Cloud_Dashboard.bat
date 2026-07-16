@echo off
setlocal

cd /d "%~dp0"
set "DASHBOARD_MODE=cloud"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 18 or newer from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo Starting CAN Logger Dashboard in CLOUD MODE...
echo.
echo Local test URL:
echo   http://localhost:5177
echo.
echo Upload endpoint for testing:
echo   http://localhost:5177/api/cloud/status
echo.

node server.js

echo.
echo Cloud-mode dashboard stopped.
pause
