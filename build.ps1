<#
    Build script for Plumbline 6 (layered architecture) — PowerShell edition.

    Stitches the layered sources under src\ into the single offline file
    dist\Plumbline_Studio_V2.html. Produces a byte-identical result to
    build.py. No third-party modules — Windows PowerShell 5+ or PowerShell 7+.

        .\build.ps1            # build dist\Plumbline_Studio_V2.html
        .\build.ps1 -Check     # build, then verify structure + print size/SHA-256

    Load-bearing order (each facade global must exist before the next layer and
    the UI run). The embedded Workflow Editor (editor\workflow-editor.html) is
    inlined verbatim as base64 and decoded at runtime; the 2026-07 editor screen
    changes do not alter this build contract.
#>
[CmdletBinding()]
param([switch]$Check)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Src  = Join-Path $Root 'src'
$Dist = Join-Path $Root 'dist'
$OutName = 'Plumbline_Studio_V2.html'

# marker, relative source path (under src\), mode ('text' | 'b64')
$Parts = @(
    @('@@STUDIO_CSS@@',        'presentation/studio.css',     'text'),
    @('@@RUNTIME_JS@@',        'engine/runtime.js',           'text'),
    @('@@ENGINE_MODULES_JS@@', 'engine/modules.gen.js',       'text'),
    @('@@ENGINE_FACADE_JS@@',  'engine/facade.js',            'text'),
    @('@@MONOID_JS@@',         'engine/monoid.js',            'text'),
    @('@@DATA_GATEWAY_JS@@',   'data/data-gateway.js',        'text'),
    @('@@LLM_GATEWAY_JS@@',    'llm/llm-gateway.js',          'text'),
    @('@@UI_MODULES_JS@@',     'app/ui-modules.gen.js',       'text'),
    @('@@SHARED_DOM_JS@@',       'app/modules/shared/dom.ts',        'text'),
    @('@@SHARED_WORKSPACE_JS@@', 'app/modules/shared/workspace.ts',  'text'),
    @('@@SHARED_AUTH_JS@@',      'app/modules/shared/auth.ts',       'text'),
    @('@@SHARED_LIBRARY_JS@@',   'app/modules/shared/library.ts',    'text'),
    @('@@MODULE_EDITOR_JS@@',    'app/modules/editor/editor.ts',     'text'),
    @('@@MODULE_ANALYSIS_JS@@',  'app/modules/analysis/analysis.ts', 'text'),
    @('@@MODULE_HOME_JS@@',      'app/modules/home/home.ts',         'text'),
    @('@@ROUTER_JS@@',           'app/router.js',                    'text'),
    @('@@UI_BOOT_JS@@',        'app/ui-boot.js',              'text'),
    @('@@EDITOR_HTML_B64@@',   'editor/workflow-editor.html', 'b64'),
    @('@@LOADER_JS@@',         'app/loader.js',               'text')
)

$RequiredGlobals = @(
    'window.PlumblineEngine',
    'window.PlumblineMonoid',
    'window.PlumblineData',
    'window.PlumblineLLM',
    'window.__PL'
)

function Read-TextFile([string]$Path) {
    # Match Python's universal-newline reads so both supported builders remain
    # byte-identical even when a source file was edited with CRLF line endings.
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
    return $text.Replace("`r`n", "`n").Replace("`r", "`n")
}

function Read-B64File([string]$Path) {
    return [System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($Path))
}

$shellPath = Join-Path $Src 'presentation/shell.html'
$html = Read-TextFile $shellPath

# Validate: each marker exactly once, each source present.
foreach ($p in $Parts) {
    $marker = $p[0]; $rel = $p[1]
    $count = ([regex]::Matches($html, [regex]::Escape($marker))).Count
    if ($count -ne 1) { throw "error: marker $marker must appear exactly once in shell.html (found $count)" }
    $srcPath = Join-Path $Src $rel
    if (-not (Test-Path -LiteralPath $srcPath)) { throw "error: missing source for $marker : $srcPath" }
}

foreach ($p in $Parts) {
    $marker = $p[0]; $rel = $p[1]; $mode = $p[2]
    $srcPath = Join-Path $Src $rel
    if ($mode -eq 'b64') { $payload = Read-B64File $srcPath } else { $payload = Read-TextFile $srcPath }
    # Ordinal literal replace so $ and backslashes in code are untouched.
    $html = $html.Replace($marker, $payload)
}

if (-not (Test-Path -LiteralPath $Dist)) { New-Item -ItemType Directory -Path $Dist | Out-Null }
$outPath = Join-Path $Dist $OutName
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($outPath, $html, $utf8NoBom)

$bytes = $utf8NoBom.GetBytes($html)
$sha = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
$hex = -join ($sha | ForEach-Object { $_.ToString('x2') })
Write-Host ("built {0}" -f $outPath)
Write-Host ("  size: {0:N0} bytes" -f $bytes.Length)
Write-Host ("  sha256: {0}" -f $hex)

if ($Check) {
    foreach ($p in $Parts) {
        if ($html.Contains($p[0])) { throw "error: unfilled marker survived into output: $($p[0])" }
    }
    foreach ($g in $RequiredGlobals) {
        if (-not $html.Contains($g)) { throw "error: expected global missing from build: $g" }
    }
    Write-Host '  check: OK — all layers inlined, facades present, no stray markers'
}
