@echo off
chcp 65001 >nul
echo Copying Food Rescue website files...
set SRC=%TEMP%\food-rescue
set DEST=%~dp0
if not exist "%SRC%" (
  echo Source not found: %SRC%
  pause
  exit /b 1
)
copy /Y "%SRC%\*.*" "%DEST%"
echo.
echo Done! Files copied to: %DEST%
dir "%DEST%\*.html" "%DEST%\*.css" "%DEST%\*.js" 2>nul
pause
