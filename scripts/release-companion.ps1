# Release companion via GitHub Actions.
# Tags the current commit, pushes the tag — GH Actions builds the Windows EXE and creates the release.
# Usage: .\scripts\release-companion.ps1 -Version 0.5.1
#
# Optional -BuildLocal flag runs a local build first as a sanity check before tagging.

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,    # e.g. "0.5.1"
    [switch]$BuildLocal  # pass -BuildLocal to build locally first
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$Tag = "companion-v$Version"

if ($BuildLocal) {
    Write-Host "==> Local sanity build..."
    pnpm --filter @rdoc-suite/shared build
    pnpm --filter @rdoc-suite/companion tauri:build
    Write-Host "==> Local build OK."
}

Write-Host "==> Tagging $Tag and pushing..."
git tag $Tag
git push origin $Tag

Write-Host ""
Write-Host "Done. GitHub Actions is building the Windows release."
Write-Host "Monitor: https://github.com/cccdemon/RDOC-Suite/actions"
Write-Host "Release:  https://github.com/cccdemon/RDOC-Suite/releases"
Write-Host "Bridge picks up the new version automatically via GITHUB_REPO."
