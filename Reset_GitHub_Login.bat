@echo off
setlocal

echo Resetting cached GitHub login for Git Credential Manager...
echo.

git credential-manager erase https://github.com

echo.
echo If the command above showed no error, cached GitHub credentials were cleared.
echo Now run Publish_To_GitHub.bat again.
echo When Git asks you to sign in, complete the browser login.
echo.
pause
