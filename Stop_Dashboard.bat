@echo off
setlocal enabledelayedexpansion

set "PORT=5177"
set "FOUND=0"

echo Looking for CAN Logger dashboard on port %PORT%...

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set "PID=%%P"
  set "FOUND=1"
  echo Stopping process !PID! on port %PORT%...
  taskkill /PID !PID! /F
)

if "%FOUND%"=="0" (
  echo No dashboard server was found on port %PORT%.
) else (
  echo Dashboard server stopped.
)

echo.
pause
