@echo off
rem Starts the Fairlight Live Web Controller in the foreground.
rem
rem It only starts: it does not install, build or configure anything. If something is missing it
rem says which command to run and stops. The POSIX counterpart is start.sh; keep the two in step.
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or newer is required, and node was not found on PATH.
  goto :fail
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%v"
if %NODE_MAJOR% LSS 22 (
  echo Node.js 22 or newer is required, found Node.js %NODE_MAJOR%.
  goto :fail
)

if not exist "apps\server\dist\main.js" goto :nobuild
if not exist "apps\web\dist\index.html" goto :nobuild

rem Every interface, so a tablet on the same network can reach it. Both stay overridable.
rem Windows asks to allow Node.js through the firewall the first time this listens on 0.0.0.0.
if not defined HOST set "HOST=0.0.0.0"
if not defined PORT set "PORT=3000"

echo Fairlight Live Web Controller - http://localhost:%PORT%  (Ctrl+C to stop)
node "apps\server\dist\main.js"
set "EXITCODE=%ERRORLEVEL%"
goto :done

:nobuild
echo Run "pnpm install" and "pnpm build" first.

:fail
set "EXITCODE=1"

:done
rem A window opened by double-clicking would otherwise vanish before the message could be read.
rem Set FLWC_NO_PAUSE=1 to run this from a script.
if not defined FLWC_NO_PAUSE pause
exit /b %EXITCODE%
