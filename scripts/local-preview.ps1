param(
    [ValidateSet('start', 'restart', 'stop')][string]$Action = 'start',
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
try {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    Set-Location -LiteralPath $projectRoot
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
    if (-not (Test-Path -LiteralPath $nodePath)) {
        throw 'Node.js is missing. Install Node.js 24 LTS, then open this file again.'
    }
    $astroPath = Join-Path $projectRoot 'node_modules\astro\bin\astro.mjs'
    if (-not (Test-Path -LiteralPath $astroPath)) {
        throw 'The website needs its packages. Open a terminal in this folder and run npm ci once.'
    }
    if ($Action -in @('stop', 'restart')) {
        if ($Action -eq 'restart') { Write-Host 'Restarting your website...' }
        & $nodePath $astroPath dev stop
        if ($LASTEXITCODE -ne 0) { throw 'The preview could not be stopped. The details are shown above.' }
        if ($Action -eq 'stop') { Write-Host 'Local preview is off. You can close its browser tab.' }
    }
    if ($Action -ne 'stop') {
        Write-Host 'Opening your website...'
        # Astro tracks this project and reuses its server when already running.
        # Its detached worker runs hidden; closing this window does not stop it.
        & $nodePath $astroPath dev --background --host localhost --port 4321
        if ($LASTEXITCODE -ne 0) { throw 'The preview could not start. The details are shown above.' }
        $server = Get-Content -Raw -LiteralPath (Join-Path $projectRoot '.astro\dev.json') | ConvertFrom-Json
        $previewUrl = [uri]$server.url
        if ($previewUrl.Scheme -ne 'http' -or $previewUrl.Host -notin @('localhost', '127.0.0.1', '[::1]')) {
            throw 'The preview returned an unexpected address. Check the terminal details above.'
        }
        if (-not $NoBrowser) { Start-Process -FilePath $previewUrl.AbsoluteUri }
        Write-Host ('Website ready: ' + $previewUrl.AbsoluteUri)
        Write-Host 'Double-click Stop website when you are finished.'
    }
    exit 0
} catch {
    Write-Host ('Could not ' + $Action + ' the website: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
