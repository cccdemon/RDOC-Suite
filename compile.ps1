#!/usr/bin/env pwsh
# Build or run the RDOC-Suite companion (Tauri) on Windows.
#   .\compile.ps1           tauri:dev  (live reload)
#   .\compile.ps1 -Prod     tauri:build (production EXE/NSIS)
#
# Do NOT set $ErrorActionPreference = 'Stop':
# PS 5.1 turns tauri's Info lines on stderr into ErrorRecords.
# We use explicit $LASTEXITCODE checks instead.

param([switch]$Prod)

$env:PATH = "C:\Program Files\nodejs;$env:APPDATA\npm;$env:USERPROFILE\.cargo\bin;" + $env:PATH
$env:VITE_BRIDGE_URL       = "https://suite.raumdock.org"
$env:VITE_FLEETPLANNER_URL = "https://suite.raumdock.org/fleetplanner"

Set-Location $PSScriptRoot

if ($Prod) {
    $signingEnv = Join-Path $PSScriptRoot ".signing.env"
    if (Test-Path $signingEnv) {
        Write-Output "==> signing env: $signingEnv"
        foreach ($line in Get-Content $signingEnv) {
            $line = $line.Trim()
            if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
                [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
                Write-Output "  set $($Matches[1])"
            }
        }
    } else {
        Write-Output "WARNING: .signing.env not found - artefacts will be unsigned"
    }
}

function Invoke-Step([string]$Label, [scriptblock]$Action) {
    Write-Output "==> $Label"
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Write-Output "FAILED: $Label (exit $LASTEXITCODE)"
        exit $LASTEXITCODE
    }
}

Invoke-Step "[1] pnpm install" { pnpm install --no-frozen-lockfile }
Invoke-Step "[2] build @rdoc-suite/shared" { pnpm --filter @rdoc-suite/shared build }

if ($Prod) {
    Invoke-Step "[3] tauri:build" { pnpm --filter @rdoc-suite/companion tauri:build }
    $out = Join-Path $PSScriptRoot 'apps\companion\src-tauri\target\release\bundle'
    Write-Output "Done. Bundles: $out\{msi,nsis}"
} else {
    Write-Output "==> [3] tauri:dev (Ctrl+C zum Beenden)"
    pnpm --filter @rdoc-suite/companion tauri:dev
}
