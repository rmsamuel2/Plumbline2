# =============================================================================
#  setup-plumbline.ps1 — one command: database check, install, build, run, open
# =============================================================================
#  Run from the repository root (the folder containing build.py, server\, src\):
#
#      powershell -ExecutionPolicy Bypass -File .\setup-plumbline.ps1
#
#  What it does, in order:
#    1. Checks prerequisites (Node 18+, npm, Python 3).
#    2. Creates server\.env from the template on first run and opens it in
#       Notepad so you can paste the Supabase connection string — then re-run.
#    3. npm install (server dependencies, first run only).
#    4. npm run migrate — applies every migrations\*.sql file through 006
#       (idempotent; safe to re-run any time).
#    5. python build.py --check — builds dist\Plumbline_Studio_V2.html.
#    6. Starts the Plumbline API in its own window.
#    7. Opens the built app in your default browser (Home page).
#
#  NOTE ON PASSWORDS: everything here uses single-quoted strings on purpose.
#  PowerShell silently expands $word inside DOUBLE quotes, which corrupts
#  Supabase passwords containing '$'. Keep any password you type in .env or
#  on a command line inside SINGLE quotes.
# =============================================================================
[CmdletBinding()]
param(
    [int]$Port = 8080,          # must match PORT in server\.env if you set one
    [switch]$SkipBuild,         # reuse the existing dist\ build
    [switch]$NoOpen             # do not launch the browser at the end
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
Write-Host ('Plumbline root: ' + $root) -ForegroundColor Cyan

# ---- 1. prerequisites -------------------------------------------------------
function Need($name, $probe) {
    try { & $probe | Out-Null; return $true } catch { return $false }
}
if (-not (Need 'node'   { node --version }))   { throw 'Node.js 18+ is required — install from https://nodejs.org and re-run.' }
if (-not (Need 'npm'    { npm --version }))    { throw 'npm was not found (comes with Node.js).' }
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) { throw ('Node ' + (node --version) + ' found; version 18 or newer is required.') }
$py = $null
foreach ($candidate in @('python', 'py')) {
    if (Need $candidate { & $candidate --version }) { $py = $candidate; break }
}
if (-not $py) { throw 'Python 3.6+ is required for the build — install from https://python.org and re-run.' }
Write-Host ('Prerequisites OK  (node ' + (node --version) + ', ' + (& $py --version) + ')') -ForegroundColor Green

# ---- 1b. filesystem sanity --------------------------------------------------
# node_modules needs a real local filesystem. Google Drive and OneDrive virtual
# filesystems corrupt npm extraction (TAR_ENTRY_ERROR, then
# ERR_INVALID_PACKAGE_CONFIG naming a different package each run). Pausing sync
# does not help. Probe with a junction, which those drivers refuse.
$probeTarget = Join-Path $env:TEMP ('pl-fsprobe-' + [guid]::NewGuid().ToString('N'))
$probeLink   = Join-Path $root    ('.pl-fsprobe-' + [guid]::NewGuid().ToString('N'))
$fsOk = $false
try {
    New-Item -ItemType Directory -Force -Path $probeTarget | Out-Null
    New-Item -ItemType Junction -Path $probeLink -Target $probeTarget -ErrorAction Stop | Out-Null
    $fsOk = $true
} catch { $fsOk = $false } finally {
    if (Test-Path $probeLink) { try { [System.IO.Directory]::Delete($probeLink, $false) } catch { } }
    if (Test-Path $probeTarget) { Remove-Item $probeTarget -Recurse -Force -ErrorAction SilentlyContinue }
}
if (-not $fsOk) {
    throw ('This folder cannot host node_modules: ' + $root + ' - it is on a virtual or synced filesystem (Google Drive, OneDrive, network share). Clone to a local disk such as C:\dev\Plumbline2 and run from there.')
}
Write-Host 'Filesystem OK (supports node_modules)' -ForegroundColor Green

# ---- 2. server\.env ---------------------------------------------------------
$envFile = Join-Path $root 'server\.env'
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $root 'server\.env.example') $envFile
    Write-Host ''
    Write-Host 'Created server\.env — fill it in, then run this script again:' -ForegroundColor Yellow
    Write-Host '  DATABASE_URL   = the Supabase URI (Project Settings -> Database -> Connection string).'
    Write-Host '                   The hostname uses the 20-character project reference id.'
    Write-Host '  SESSION_SECRET = any long random string (this signs login cookies).'
    Write-Host '  ANTHROPIC_API_KEY = only needed for the LLM features; leave as-is otherwise.'
    Write-Host ''
    Write-Host 'Opening it in Notepad now...'
    Start-Process notepad $envFile
    exit 0
}
$envText = Get-Content $envFile -Raw
if ($envText -match 'postgres://user:password@host') {
    Start-Process notepad $envFile
    throw 'server\.env still contains the placeholder DATABASE_URL — paste the real Supabase connection string and re-run.'
}

# ---- 3. install server dependencies ----------------------------------------
if (-not (Test-Path (Join-Path $root 'server\node_modules'))) {
    Write-Host 'Installing server dependencies (npm install)...' -ForegroundColor Cyan
    Push-Location (Join-Path $root 'server')
    npm install
    $npmExit = $LASTEXITCODE
    Pop-Location
    if ($npmExit -ne 0) { throw 'npm install FAILED - see the output above. A partial node_modules will fail in confusing ways.' }
} else {
    Write-Host 'Server dependencies already installed.' -ForegroundColor Green
}

# ---- 4. migrate the database (idempotent) -----------------------------------
Write-Host 'Applying database migrations through 006...' -ForegroundColor Cyan
Push-Location (Join-Path $root 'server')
npm run migrate
$migrateExit = $LASTEXITCODE
Pop-Location
if ($migrateExit -ne 0) { throw 'Database migration FAILED - see the output above. The schema has NOT been applied.' }
Write-Host 'Database is ready.' -ForegroundColor Green

# ---- 5. build the single-file app -------------------------------------------
if (-not $SkipBuild) {
    Write-Host 'Building dist\Plumbline_Studio_V2.html ...' -ForegroundColor Cyan
    & $py build.py --check
    if ($LASTEXITCODE -ne 0) { throw 'Build failed — see the output above.' }
} else {
    Write-Host 'Skipping build (-SkipBuild).' -ForegroundColor Yellow
}

# ---- 6. start the API (its own window; close that window to stop it) --------
$health = 'http://localhost:' + $Port + '/api/health'
$alreadyUp = $false
try {
    $r = Invoke-RestMethod -Uri $health -TimeoutSec 2
    if ($r.ok) { $alreadyUp = $true }
} catch { }
if ($alreadyUp) {
    Write-Host ('Plumbline API is already running on port ' + $Port + '.') -ForegroundColor Green
} else {
    Write-Host ('Starting the Plumbline API on port ' + $Port + ' (new window)...') -ForegroundColor Cyan
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/k', 'title Plumbline API && npm start' `
        -WorkingDirectory (Join-Path $root 'server')
    $up = $false
    foreach ($i in 1..30) {
        Start-Sleep -Milliseconds 700
        try { $r = Invoke-RestMethod -Uri $health -TimeoutSec 2; if ($r.ok) { $up = $true; break } } catch { }
    }
    if (-not $up) { throw ('The API did not answer on ' + $health + ' — check the "Plumbline API" window for the error (usually DATABASE_URL).') }
    Write-Host ('API is up: ' + $health) -ForegroundColor Green
}

# ---- 7. open the app on the Home page ----------------------------------------
$app = Join-Path $root 'dist\Plumbline_Studio_V2.html'
if (-not (Test-Path $app)) { throw ('Built app not found at ' + $app) }
$appUrl = 'http://localhost:' + $Port + '/#/home'
if (-not $NoOpen) {
    Write-Host 'Opening the app (Home page)...' -ForegroundColor Cyan
    Start-Process $appUrl
}

Write-Host ''
Write-Host '================================================================' -ForegroundColor Green
Write-Host ' Plumbline is running.'
Write-Host ('   App    : ' + $appUrl)
Write-Host ('   API    : http://localhost:' + $Port + '   (close the "Plumbline API" window to stop)')
Write-Host '   Sign in: rob / password   or   max / password'
Write-Host '   >>> Change BOTH seeded passwords immediately:'
Write-Host '       Login -> Account -> Change password  (revokes old sessions, audited).'
Write-Host '================================================================' -ForegroundColor Green
