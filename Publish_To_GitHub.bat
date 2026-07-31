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
echo IMPORTANT:
echo GitHub does not accept account passwords for git push.
echo If Git asks for a password, use a GitHub Personal Access Token instead.
echo If a bad login is cached, run Reset_GitHub_Login.bat first.
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
echo If a browser sign-in opens, sign in as the owner of the repo and approve Git Credential Manager.
git push -u origin main

if errorlevel 1 (
  echo.
  echo Push failed.
  echo Most common fix: run Reset_GitHub_Login.bat, then run this publisher again.
  echo You can also use GitHub Desktop to publish this folder.
  pause
  exit /b 1
)

echo.
echo Done. Your dashboard code is now on GitHub.
echo Next: connect this GitHub repo to Render as a Web Service.
pause
