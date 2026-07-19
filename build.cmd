@echo off
REM Build Plumbline 6 into dist\Plumbline_Studio_V2.html.
REM Uses Python if available (build.py), otherwise falls back to PowerShell (build.ps1).
REM Any argument (e.g. --check) is forwarded to the chosen builder.
setlocal
set "HERE=%~dp0"

where python >nul 2>nul
if %ERRORLEVEL%==0 (
    python "%HERE%build.py" %*
    goto :done
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
    py -3 "%HERE%build.py" %*
    goto :done
)

echo Python not found; building with PowerShell...
if /I "%~1"=="--check" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%build.ps1" -Check
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%build.ps1" %*
)

:done
endlocal
