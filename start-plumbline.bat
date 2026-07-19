@echo off
REM ============================================================
REM  start-plumbline.bat
REM  Starts the Plumbline server, waits for it to come up,
REM  then opens Microsoft Edge at the app URL.
REM ============================================================

setlocal
set "SERVER_DIR=C:\dev\plumbline5\server"
set "URL=http://localhost:8080"
set "PORT=8080"

echo Starting Plumbline server in %SERVER_DIR% ...

REM Launch the server in its own window so this script can continue.
REM The server window stays open (cmd /k) so you can see logs and Ctrl+C to stop it.
start "Plumbline Server" cmd /k "cd /d %SERVER_DIR% && npm start"

echo Waiting for the server to listen on port %PORT% ...

REM Poll the port until something is listening (max ~30 seconds).
set /a tries=0
:waitloop
set /a tries+=1
REM netstat returns the line only once the port is in LISTENING state.
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if %errorlevel%==0 goto ready
if %tries% geq 30 goto timeout
timeout /t 1 /nobreak >nul
goto waitloop

:timeout
echo.
echo WARNING: Server did not start listening on port %PORT% within 30 seconds.
echo Opening Edge anyway - if the page fails, check the server window for errors.

:ready
echo Server is up. Opening Edge at %URL% ...
start msedge "%URL%"

endlocal