@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
set "WAD_LAUNCHER=%~dp0scripts\launch.ps1"
set "WAD_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

if not exist "%WAD_LAUNCHER%" goto missing_launcher
if not exist "%WAD_POWERSHELL%" goto missing_powershell
if /i "%~1"=="--check" goto check

"%WAD_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%WAD_LAUNCHER%"
goto result

:check
"%WAD_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%WAD_LAUNCHER%" -Check
goto result

:missing_launcher
echo [Words Actually Dance] Missing scripts\launch.ps1.
echo Keep start.cmd together with the project folders.
set "WAD_EXIT_CODE=1"
goto failure

:missing_powershell
echo [Words Actually Dance] Windows PowerShell could not be found.
set "WAD_EXIT_CODE=1"
goto failure

:result
set "WAD_EXIT_CODE=%errorlevel%"
if "%WAD_EXIT_CODE%"=="0" exit /b 0

:failure
if /i "%~1"=="--check" exit /b %WAD_EXIT_CODE%
echo.
pause
exit /b %WAD_EXIT_CODE%
