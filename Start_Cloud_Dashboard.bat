@echo off
setlocal

cd /d "%~dp0"
set "DASHBOARD_MODE=cloud"
set "CUSTOMER_ID=CANLOGGER-001"

REM Login uses Supabase Auth now. Skip login for this local smoke test unless
REM you have already set SUPABASE_URL, SUPABASE_ANON_KEY, and
REM SESSION_COOKIE_SECRET in your environment (see .env.example).
if not defined SUPABASE_URL set "DASHBOARD_AUTH=off"

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
if defined SUPABASE_URL (
  echo Login uses your Supabase Auth user ^(see .env.example^).
) else (
  echo DASHBOARD_AUTH=off - login is skipped for this local smoke test.
)
echo.
echo Upload endpoint for testing:
echo   http://localhost:5177/api/cloud/status
echo.

node server.js

echo.
echo Cloud-mode dashboard stopped.
pause
