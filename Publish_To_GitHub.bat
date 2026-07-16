@echo off
setlocal

cd /d "%~dp0"

set "DASHBOARD_DIR=%CD%"

echo CAN Logger Dashboard GitHub Publisher
echo.
echo Marking dashboard folder as safe for Git...
git config --global --add safe.directory "%DASHBOARD_DIR%"
if errorlevel 1 (
  echo Git could not add the safe.directory exception.
  pause
  exit /b 1
)

echo.
echo First create an EMPTY GitHub repository in your browser.
echo Do not add README, .gitignore, or license on GitHub because this local repo already has files.
echo.
set /p REPO_URL=Paste GitHub repo URL here: 

if "%REPO_URL%"=="" (
  echo No repo URL entered.
  pause
  exit /b 1
)

git remote remove origin >nul 2>nul
git remote add origin "%REPO_URL%"
git branch -M main

echo.
echo Pushing dashboard to GitHub...
git push -u origin main

if errorlevel 1 (
  echo.
  echo Push failed.
  echo Check that the URL is correct and that GitHub login/authentication is available.
  echo If Git asks for sign-in, complete the browser login and run this file again.
  pause
  exit /b 1
)

echo.
echo Done. Your dashboard code is now on GitHub.
echo Next: connect this GitHub repo to Render as a Web Service.
pause
