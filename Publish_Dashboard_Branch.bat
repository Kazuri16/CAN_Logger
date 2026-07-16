@echo off
setlocal

cd /d "%~dp0"

set "DASHBOARD_DIR=%CD%"
set "BRANCH_NAME=dashboard-cloud"

echo CAN Logger Dashboard Branch Publisher
echo.
echo This publishes the dashboard to a separate GitHub branch:
echo   %BRANCH_NAME%
echo.
echo Use this when the GitHub repo already has files on main.
echo It will NOT overwrite the existing main branch.
echo.

git config --global --add safe.directory "%DASHBOARD_DIR%"

echo Current remote:
git remote -v

echo.
set /p REPO_URL=Paste GitHub repo URL here, or press Enter to use current origin: 
if not "%REPO_URL%"=="" (
  git remote remove origin >nul 2>nul
  git remote add origin "%REPO_URL%"
)

git branch -M main

echo.
echo Pushing dashboard to branch %BRANCH_NAME%...
git push -u origin main:%BRANCH_NAME%

if errorlevel 1 (
  echo.
  echo Push failed.
  echo If GitHub asks for password, use a Personal Access Token, not your account password.
  echo If credentials are cached badly, run Reset_GitHub_Login.bat and try again.
  pause
  exit /b 1
)

echo.
echo Done. Dashboard is pushed to GitHub branch: %BRANCH_NAME%
echo.
echo In Render, select:
echo   Repository: your CAN_Logger repo
echo   Branch: %BRANCH_NAME%
echo   Root Directory: leave blank
echo   Build Command: npm install
echo   Start Command: npm start
echo.
pause
