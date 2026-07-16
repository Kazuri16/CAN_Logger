@echo off
setlocal

cd /d "%~dp0"

echo CAN Logger Dashboard GitHub Publisher
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
  echo Push failed. Check that the URL is correct and that GitHub login/authentication is available.
  pause
  exit /b 1
)

echo.
echo Done. Your dashboard code is now on GitHub.
echo Next: connect this GitHub repo to Render as a Web Service.
pause
