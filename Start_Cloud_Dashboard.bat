@echo off
setlocal

cd /d "%~dp0"
set "DASHBOARD_MODE=cloud"
set "DASHBOARD_AUTH_EMAIL=customer@example.com"
set "CUSTOMER_ID=CANLOGGER-001"

set /p DASHBOARD_AUTH_PASSWORD=Enter temporary local dashboard password: 
if "%DASHBOARD_AUTH_PASSWORD%"=="" (
  echo Password is required for local cloud mode.
  pause
  exit /b 1
)

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
echo Login for local cloud test:
echo   Email: customer@example.com
echo   Password: the password you just entered
echo.
echo Upload endpoint for testing:
echo   http://localhost:5177/api/cloud/status
echo.

node server.js

echo.
echo Cloud-mode dashboard stopped.
pause
