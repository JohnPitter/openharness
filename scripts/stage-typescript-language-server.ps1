# Copy typescript-language-server + its typescript peer + Windows .bin shims
# into the staged dsh-runtime. `pnpm deploy --prod` of @deepseek-ai/dsh can
# omit this CLI-only dependency; lsp-stdio resolveExecutable still requires
# the command on PATH at preset mount, so the packaged exe must ship it.
param(
    [string]$RepoRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'

$srcRoots = @(
    (Join-Path $RepoRoot 'deepseek-harness\apps\cli\node_modules'),
    (Join-Path $RepoRoot 'deepseek-harness\node_modules')
)
$destRoot = Join-Path $RepoRoot 'dsh-runtime\node_modules'
$destBin = Join-Path $destRoot '.bin'

function Find-PackageDir([string]$Name) {
    foreach ($root in $srcRoots) {
        $cand = Join-Path $root $Name
        if (Test-Path (Join-Path $cand 'package.json')) {
            return (Resolve-Path $cand).Path
        }
    }
    return $null
}

function Copy-PackageReal([string]$Name) {
    $src = Find-PackageDir $Name
    if (-not $src) {
        throw "stage-typescript-language-server: package '$Name' not found under apps/cli or deepseek-harness node_modules (run pnpm install in deepseek-harness)"
    }
    $dest = Join-Path $destRoot $Name
    New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
    if (Test-Path $dest) {
        Remove-Item -Recurse -Force $dest
    }
    Copy-Item -Recurse -Force $src $dest
}

function Copy-BinShim([string]$Name) {
    New-Item -ItemType Directory -Force -Path $destBin | Out-Null
    $copied = $false
    foreach ($root in $srcRoots) {
        $bin = Join-Path $root '.bin'
        foreach ($leaf in @($Name, "$Name.CMD", "$Name.cmd", "$Name.ps1")) {
            $src = Join-Path $bin $leaf
            if (Test-Path $src) {
                Copy-Item -Force $src (Join-Path $destBin $leaf)
                $copied = $true
            }
        }
        if ($copied) {
            return
        }
    }
    throw "stage-typescript-language-server: no .bin shim for '$Name' (run pnpm install in deepseek-harness)"
}

Copy-PackageReal 'typescript-language-server'
Copy-PackageReal 'typescript'
Copy-BinShim 'typescript-language-server'

$cmd = Join-Path $destBin 'typescript-language-server.CMD'
$cli = Join-Path $destRoot 'typescript-language-server\lib\cli.mjs'
if (-not (Test-Path $cmd) -and -not (Test-Path (Join-Path $destBin 'typescript-language-server.cmd'))) {
    throw "stage-typescript-language-server: missing Windows .cmd shim in $destBin"
}
if (-not (Test-Path $cli)) {
    throw "stage-typescript-language-server: missing $cli"
}
Write-Host "staged typescript-language-server + typescript into $destRoot"
