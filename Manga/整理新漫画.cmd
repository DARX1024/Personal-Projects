@echo off
setlocal
for /f "tokens=2 delims=:" %%c in ('chcp') do set "mangaPreviousPage=%%c"
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_intake.ps1" %*
set "mangaExit=%ERRORLEVEL%"
if "%~1"=="" pause
if defined mangaPreviousPage chcp %mangaPreviousPage% >nul
exit /b %mangaExit%
