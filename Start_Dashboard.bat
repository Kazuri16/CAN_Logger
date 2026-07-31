@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 18 or newer from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo Starting CAN Logger Vehicle Health Dashboard...
echo.
echo Dashboard URL:
echo   http://localhost:5177
echo.
echo Keep this window open while using the dashboard.
echo To stop, close this window or run Stop_Dashboard.bat.
echo.

node server.js

echo.
echo Dashboard stopped.
pause
