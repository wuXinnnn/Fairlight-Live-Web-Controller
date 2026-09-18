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

rem A .env beside this script, if there is one, is where HOST, PORT and the FLWC_* paths can be
rem kept. Node reads it itself; see .env.example. A variable already set in the environment still
rem wins over the file, so `set PORT=3100 ^&^& start.cmd` overrides it for one run.
set "ENVARG="
if exist ".env" set "ENVARG=--env-file=.env"

rem Ask node what it will really see. The default further down must not shadow the file, and the
rem address printed has to be the one it will actually listen on. The dash stands for "not set",
rem so the value is never empty and the token below always exists.
set "EFFHOST=-"
set "EFFPORT=-"
for /f "usebackq tokens=1,* delims==" %%A in (`node %ENVARG% -e "const e=process.env,v=k=>e[k]?e[k]:'-';console.log('HOST='+v('HOST'));console.log('PORT='+v('PORT'))"`) do (
  if "%%A"=="HOST" set "EFFHOST=%%B"
  if "%%A"=="PORT" set "EFFPORT=%%B"
)

rem Every interface, so a tablet on the same network can reach it, unless something already said
rem otherwise. Windows asks to allow Node.js through the firewall the first time it listens on
rem 0.0.0.0.
if "%EFFHOST%"=="-" set "HOST=0.0.0.0"
if "%EFFPORT%"=="-" set "EFFPORT=3000"

echo Fairlight Live Web Controller - http://localhost:%EFFPORT%  (Ctrl+C to stop)
node %ENVARG% "apps\server\dist\main.js"
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
