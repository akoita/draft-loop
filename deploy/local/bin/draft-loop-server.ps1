# Installs and runs DraftLoop's self-hosted server (ADR 0011, D15) with Docker only: no clone, no
# Node and no build. The bash twin is draft-loop-server. See docs/operations/self-hosted.md.
#
#   draft-loop-server.ps1 install <version> [folder]   download a release's stack into a folder
#   draft-loop-server.ps1 up | down | status | logs [service] | token
#   draft-loop-server.ps1 upgrade <version>            switch to a newer release and restart
#
# Every command except install works on the folder that holds this script's bin\ folder, or on
# DRAFT_LOOP_SERVER_HOME. It never prints a secret except the owner token you ask for.
param(
  [Parameter(Position = 0)][string]$Command = "help",
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest = @()
)
$Rest = @($Rest | Where-Object { $null -ne $_ })
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Repository = "akoita/draft-loop"
# Where release bundles come from: the tag's source archive on GitHub. Tests point it at a local
# archive; {version} is replaced with the version asked for.
$SourceTemplate = if ($env:DRAFT_LOOP_SERVER_SOURCE) { $env:DRAFT_LOOP_SERVER_SOURCE } else {
  "https://codeload.github.com/$Repository/tar.gz/refs/tags/server-v{version}"
}

function Fail([string]$Message) {
  [Console]::Error.WriteLine("draft-loop-server: $Message")
  exit 1
}

function Show-Usage {
  Get-Content -LiteralPath $PSCommandPath | Select-Object -Skip 3 -First 3 |
    ForEach-Object { $_ -replace '^# ?', '' }
}

function Get-ServerHome {
  if ($env:DRAFT_LOOP_SERVER_HOME) { return $env:DRAFT_LOOP_SERVER_HOME }
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Assert-Version([string]$Version) {
  if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
    Fail "the version must look like 0.12.0, not '$Version'."
  }
}

# The version an installed folder runs, from its .env file.
function Get-InstalledVersion([string]$ServerHome) {
  $envFile = Join-Path $ServerHome ".env"
  if (-not (Test-Path -LiteralPath $envFile)) { return "" }
  $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^DRAFT_LOOP_VERSION=' } |
    Select-Object -Last 1
  if ($null -eq $line) { return "" }
  return $line.Substring("DRAFT_LOOP_VERSION=".Length)
}

# Writes DRAFT_LOOP_VERSION into .env and keeps every other setting there. Compose reads the file,
# so it is written as UTF-8 without a byte order mark and with Unix line endings.
function Set-InstalledVersion([string]$ServerHome, [string]$Version) {
  $envFile = Join-Path $ServerHome ".env"
  $kept = @()
  if (Test-Path -LiteralPath $envFile) {
    $kept = @(Get-Content -LiteralPath $envFile | Where-Object { $_ -notmatch '^DRAFT_LOOP_VERSION=' })
  }
  $lines = @("DRAFT_LOOP_VERSION=$Version") + $kept
  $text = ($lines -join "`n") + "`n"
  [System.IO.File]::WriteAllText($envFile, $text, (New-Object System.Text.UTF8Encoding $false))
}

# Downloads one release's deploy/local folder into a new temporary folder and returns its path.
function Get-Bundle([string]$Version) {
  $source = $SourceTemplate.Replace("{version}", $Version)
  $scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("draft-loop-server-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path (Join-Path $scratch "bundle") | Out-Null
  $archive = Join-Path $scratch "source.tar.gz"
  if (Test-Path -LiteralPath $source -PathType Leaf) {
    Copy-Item -LiteralPath $source -Destination $archive
  } else {
    try {
      Invoke-WebRequest -Uri $source -OutFile $archive -UseBasicParsing
    } catch {
      Fail "could not download server-v$Version from $source."
    }
  }
  # Windows 10 and later ship bsdtar as tar.exe; it matches the pattern without --wildcards.
  $bundle = Join-Path $scratch "bundle"
  & tar -xzf $archive -C $bundle --strip-components=3 '*/deploy/local/*' 2>$null
  if ($LASTEXITCODE -ne 0) {
    & tar -xzf $archive -C $bundle --strip-components=3 --wildcards '*/deploy/local/*' 2>$null
  }
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $bundle "compose.yaml"))) {
    Fail "server-v$Version has no self-hosted stack in its archive."
  }
  return $scratch
}

# Copies a bundle's files into a folder, keeping the folder's keys and settings.
function Copy-Bundle([string]$Bundle, [string]$ServerHome) {
  $keys = Join-Path $ServerHome "keys"
  New-Item -ItemType Directory -Force -Path $keys | Out-Null
  foreach ($item in @("compose.yaml", "README.md", "init", "bin")) {
    $from = Join-Path $Bundle $item
    if (-not (Test-Path -LiteralPath $from)) { continue }
    $to = Join-Path $ServerHome $item
    if (Test-Path -LiteralPath $to) { Remove-Item -LiteralPath $to -Recurse -Force }
    Copy-Item -LiteralPath $from -Destination $to -Recurse
  }
  $ignore = Join-Path $keys ".gitignore"
  if (-not (Test-Path -LiteralPath $ignore)) {
    Copy-Item -LiteralPath (Join-Path $Bundle "keys/.gitignore") -Destination $ignore
  }
}

function Invoke-Compose([string[]]$Arguments) {
  $serverHome = Get-ServerHome
  $compose = Join-Path $serverHome "compose.yaml"
  if (-not (Test-Path -LiteralPath $compose)) {
    Fail "$serverHome holds no self-hosted stack; run install first."
  }
  if ((Get-InstalledVersion $serverHome) -eq "") { Fail "$serverHome\.env names no DRAFT_LOOP_VERSION." }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker is needed; install Docker Desktop."
  }
  & docker compose --file $compose @Arguments
  exit $LASTEXITCODE
}

function Install-Server([string[]]$Arguments) {
  if ($Arguments.Count -lt 1 -or $Arguments[0] -eq "") {
    Fail "say which version to install, such as: install 0.12.0"
  }
  $version = $Arguments[0]
  Assert-Version $version
  $serverHome = if ($Arguments.Count -ge 2) { $Arguments[1] } else {
    Join-Path $HOME "draft-loop-server"
  }
  if (Test-Path -LiteralPath (Join-Path $serverHome "compose.yaml")) {
    Fail "$serverHome already holds a stack; use upgrade instead."
  }
  $scratch = Get-Bundle $version
  New-Item -ItemType Directory -Force -Path $serverHome | Out-Null
  Copy-Bundle (Join-Path $scratch "bundle") $serverHome
  Remove-Item -LiteralPath $scratch -Recurse -Force
  Set-InstalledVersion $serverHome $version
  Write-Output "Installed DraftLoop server $version in $serverHome."
  Write-Output "Next: put anthropic_api_key (and openai_api_key if you use OpenAI) in $(Join-Path $serverHome 'keys'),"
  Write-Output "then run $(Join-Path $serverHome 'bin/draft-loop-server.ps1') up"
}

function Update-Server([string[]]$Arguments) {
  if ($Arguments.Count -lt 1 -or $Arguments[0] -eq "") {
    Fail "say which version to upgrade to, such as: upgrade 0.13.0"
  }
  $version = $Arguments[0]
  Assert-Version $version
  $serverHome = Get-ServerHome
  if (-not (Test-Path -LiteralPath (Join-Path $serverHome "compose.yaml"))) {
    Fail "$serverHome holds no self-hosted stack; run install first."
  }
  $current = Get-InstalledVersion $serverHome
  if ($current -ne "" -and [version]$version -lt [version]$current) {
    Fail "$serverHome runs $current; going back to $version is not supported. Restore a backup instead."
  }
  $scratch = Get-Bundle $version
  Copy-Bundle (Join-Path $scratch "bundle") $serverHome
  Remove-Item -LiteralPath $scratch -Recurse -Force
  Set-InstalledVersion $serverHome $version
  Write-Output "Switched $serverHome to DraftLoop server $version; starting it."
  # Pulls the new images, runs the migrations, then restarts the API and the worker.
  Invoke-Compose @("up", "--detach", "--wait", "--remove-orphans")
}

switch ($Command) {
  "install" { Install-Server $Rest }
  "upgrade" { Update-Server $Rest }
  "up" { Invoke-Compose @("up", "--detach", "--wait", "--remove-orphans") }
  "down" { Invoke-Compose @("down") }
  "status" { Invoke-Compose @("ps") }
  "logs" { Invoke-Compose (@("logs", "--tail", "200") + $Rest) }
  "token" { Invoke-Compose @("exec", "-T", "api", "cat", "/secrets/owner_token") }
  { $_ -in @("help", "--help", "-h") } { Show-Usage }
  default {
    Show-Usage | ForEach-Object { [Console]::Error.WriteLine($_) }
    exit 2
  }
}
