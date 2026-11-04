# Installs and runs DraftLoop's self-hosted server (ADR 0011, D15) with Docker only: no clone, no
# Node and no build. The bash twin is draft-loop-server. See docs/operations/self-hosted.md.
#
#   draft-loop-server.ps1 install <version> [folder]   download a release's stack into a folder
#   draft-loop-server.ps1 up | down | status | logs [service] | token
#   draft-loop-server.ps1 token --rotate                replace the owner token and restart the API
#   draft-loop-server.ps1 upgrade <version>            switch to a newer release and restart
#   draft-loop-server.ps1 backup [file] | restore <file>   one archive of the database, files and secrets
#
# Every command except install works on DRAFT_LOOP_SERVER_HOME, else on the folder that holds
# this script's bin\ folder, else, for a downloaded copy, on ~\draft-loop-server. It never prints a secret except the owner token you ask for.
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
  Get-Content -LiteralPath $PSCommandPath | Select-Object -Skip 3 -First 5 |
    ForEach-Object { $_ -replace '^# ?', '' }
}

function Get-ServerHome {
  if ($env:DRAFT_LOOP_SERVER_HOME) { return $env:DRAFT_LOOP_SERVER_HOME }
  $own = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  # A downloaded copy, such as one in Downloads, sits in no stack: use install's default.
  $default = Join-Path $HOME "draft-loop-server"
  if (-not (Test-Path -LiteralPath (Join-Path $own "compose.yaml")) -and
    (Test-Path -LiteralPath (Join-Path $default "compose.yaml"))) {
    return $default
  }
  return $own
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

# The docker compose file arguments for the installed folder, after checking it holds a stack.
function Get-ComposeFiles {
  $serverHome = Get-ServerHome
  $compose = Join-Path $serverHome "compose.yaml"
  if (-not (Test-Path -LiteralPath $compose)) {
    Fail "$serverHome holds no self-hosted stack; run install first."
  }
  if ((Get-InstalledVersion $serverHome) -eq "") { Fail "$serverHome\.env names no DRAFT_LOOP_VERSION." }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker is needed; install Docker Desktop."
  }
  $files = @("--file", $compose)
  # Your own changes go in compose.override.yaml, which install and upgrade never touch.
  $override = Join-Path $serverHome "compose.override.yaml"
  if (Test-Path -LiteralPath $override) { $files += @("--file", $override) }
  return , $files
}

# Runs one docker compose step, shows its output and returns only its exit code.
function Invoke-ComposeStep([string[]]$Arguments) {
  $files = Get-ComposeFiles
  & docker compose @files @Arguments | Out-Host
  return $LASTEXITCODE
}

# Runs docker compose with its output on this script's own output, then exits with its code.
function Invoke-Compose([string[]]$Arguments) {
  $files = Get-ComposeFiles
  & docker compose @files @Arguments
  exit $LASTEXITCODE
}

# Starts the stack, then says where it answers and how to sign in, so a first start needs no
# README. It names the token command, never the token.
function Start-Server {
  $files = Get-ComposeFiles
  & docker compose @files up --detach --wait --remove-orphans
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $serverHome = Get-ServerHome
  $port = "8080"
  $envFile = Join-Path $serverHome ".env"
  if (Test-Path -LiteralPath $envFile) {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^DRAFT_LOOP_PORT=' } |
      Select-Object -Last 1
    if ($null -ne $line -and $line.Length -gt "DRAFT_LOOP_PORT=".Length) {
      $port = $line.Substring("DRAFT_LOOP_PORT=".Length)
    }
  }
  $script = Join-Path (Join-Path $serverHome "bin") "draft-loop-server.ps1"
  Write-Output ""
  Write-Output "DraftLoop is running at http://127.0.0.1:$port"
  Write-Output "Sign in with the owner token, which this prints: $script token"
  if ($port -eq "8080") {
    Write-Output "Desktop app: get DraftLoop from https://github.com/$Repository/releases and choose This computer."
  } else {
    Write-Output "Desktop app: get DraftLoop from https://github.com/$Repository/releases and add http://127.0.0.1:$port."
  }
  exit 0
}

$BackupFormat = "draft-loop-self-hosted-backup"

function New-ScratchFolder {
  $scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("draft-loop-server-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $scratch | Out-Null
  return $scratch
}

# Writes one archive while the stack runs: a custom-format database dump, the volume holding the
# uploaded and exported files, and the generated secrets (owner token and database passwords).
# Provider keys stay in keys\ and are not included. Files move through a mounted folder and
# `compose cp`, never through a pipe, which Windows PowerShell would not keep byte for byte.
function Backup-Server([string[]]$Arguments) {
  $serverHome = Get-ServerHome
  $version = Get-InstalledVersion $serverHome
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
  $target = if ($Arguments.Count -ge 1) { $Arguments[0] } else { "draft-loop-backup-$version-$stamp.tar.gz" }
  if (Test-Path -LiteralPath $target) { Fail "$target already exists; name a new file." }
  $scratch = New-ScratchFolder
  if ((Invoke-ComposeStep @("exec", "-T", "postgres", "pg_dump", "--username=postgres", "--format=custom",
        "--file=/tmp/draft-loop-backup.dump", "draft_loop")) -ne 0) {
    Fail "the database dump failed; is the stack up?"
  }
  Invoke-ComposeStep @("cp", "postgres:/tmp/draft-loop-backup.dump", (Join-Path $scratch "database.dump")) | Out-Null
  Invoke-ComposeStep @("exec", "-T", "postgres", "rm", "-f", "/tmp/draft-loop-backup.dump") | Out-Null
  if ((Invoke-ComposeStep @("run", "--rm", "--no-deps", "-T", "--volume", "${scratch}:/backup",
        "--entrypoint", "tar", "init", "-czf", "/backup/files.tar.gz", "-C", "/", "blobs", "secrets",
        "postgres-secrets")) -ne 0) {
    Fail "copying the files and secrets failed."
  }
  $created = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $manifest = '{"format":"' + $BackupFormat + '","formatVersion":1,"serverVersion":"' + $version +
    '","createdAt":"' + $created + '"}' + "`n"
  [System.IO.File]::WriteAllText((Join-Path $scratch "backup.json"), $manifest,
    (New-Object System.Text.UTF8Encoding $false))
  & tar -czf $target -C $scratch backup.json database.dump files.tar.gz
  if ($LASTEXITCODE -ne 0) { Fail "writing $target failed." }
  Remove-Item -LiteralPath $scratch -Recurse -Force
  Write-Output "Wrote $target. Keep it private: it holds your career material and the stack's passwords."
}

# Loads an archive into a stack that has never started, or was erased: the files and secrets
# first, then Postgres alone, its runtime role, the dump, and finally every service.
function Restore-Server([string[]]$Arguments) {
  if ($Arguments.Count -lt 1 -or $Arguments[0] -eq "") {
    Fail "say which archive to restore, such as: restore draft-loop-backup.tar.gz"
  }
  $archive = $Arguments[0]
  if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { Fail "$archive is not a file." }
  $serverHome = Get-ServerHome
  $version = Get-InstalledVersion $serverHome
  $scratch = New-ScratchFolder
  & tar -xzf $archive -C $scratch backup.json database.dump files.tar.gz 2>$null
  $manifestFile = Join-Path $scratch "backup.json"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $manifestFile)) {
    Fail "$archive is not a DraftLoop server backup."
  }
  $manifest = Get-Content -Raw -LiteralPath $manifestFile | ConvertFrom-Json
  if ($manifest.format -ne $BackupFormat -or $manifest.formatVersion -ne 1) {
    Fail "$archive is not a DraftLoop server backup."
  }
  $saved = [string]$manifest.serverVersion
  if ([version]$saved -gt [version]$version) {
    Fail "$archive comes from server $saved, newer than $version here; upgrade to $saved first."
  }
  if ((Invoke-ComposeStep @("run", "--rm", "--no-deps", "-T", "--entrypoint", "sh", "init", "-c",
        "test ! -s /secrets/owner_token")) -ne 0) {
    Fail "this stack already holds data. Restore only into a new install, or erase this one first with: docker compose --file $(Join-Path $serverHome 'compose.yaml') down --volumes"
  }
  if ((Invoke-ComposeStep @("run", "--rm", "--no-deps", "-T", "--volume", "${scratch}:/backup:ro",
        "--entrypoint", "tar", "init", "-xzf", "/backup/files.tar.gz", "-C", "/")) -ne 0) {
    Fail "unpacking the files and secrets failed."
  }
  if ((Invoke-ComposeStep @("up", "--detach", "--wait", "postgres")) -ne 0) { Fail "Postgres did not start." }
  if ((Invoke-ComposeStep @("run", "--rm", "--no-deps", "postgres-setup")) -ne 0) {
    Fail "creating the database role failed."
  }
  Invoke-ComposeStep @("cp", (Join-Path $scratch "database.dump"), "postgres:/tmp/draft-loop-restore.dump") | Out-Null
  if ((Invoke-ComposeStep @("exec", "-T", "postgres", "pg_restore", "--username=postgres",
        "--dbname=draft_loop", "--exit-on-error", "/tmp/draft-loop-restore.dump")) -ne 0) {
    Fail "loading the database failed."
  }
  Invoke-ComposeStep @("exec", "-T", "postgres", "rm", "-f", "/tmp/draft-loop-restore.dump") | Out-Null
  Remove-Item -LiteralPath $scratch -Recurse -Force
  if ((Invoke-ComposeStep @("up", "--detach", "--wait", "--remove-orphans")) -ne 0) {
    Fail "the restored stack did not start."
  }
  Write-Output "Restored $archive (server $saved) into $serverHome."
}

function Install-Server([string[]]$Arguments) {
  if ($Arguments.Count -lt 1 -or $Arguments[0] -eq "") {
    Fail "say which version to install, such as: install 0.14.0"
  }
  $version = $Arguments[0]
  Assert-Version $version
  $serverHome = if ($Arguments.Count -ge 2) { $Arguments[1] } else {
    Join-Path $HOME "draft-loop-server"
  }
  if (Test-Path -LiteralPath (Join-Path $serverHome "compose.yaml")) {
    Fail "$serverHome already holds a stack; use upgrade instead."
  }
  if (Test-Path -LiteralPath $serverHome -PathType Leaf) {
    Fail "$serverHome is a file, not a folder: if it is a downloaded copy of this script, move or delete it, or name another folder after the version."
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
    Fail "say which version to upgrade to, such as: upgrade 0.14.0"
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
  Start-Server
}

# Replaces the owner token (threat model S-004, #2146): removes it, lets the init step create a
# new one, and recreates the API, which reads it at start. Agent tokens stay valid. It never prints
# the old or the new token.
function Reset-OwnerToken {
  $steps = @(
    @("run", "--rm", "--no-deps", "-T", "--entrypoint", "sh", "init", "-c", "rm -f /secrets/owner_token"),
    @("run", "--rm", "--no-deps", "-T", "init"),
    @("up", "--detach", "--wait", "--no-deps", "--force-recreate", "api")
  )
  foreach ($step in $steps) {
    if ((Invoke-ComposeStep $step) -ne 0) { Fail "replacing the owner token failed; run up, then try again." }
  }
  $script = Join-Path (Join-Path (Get-ServerHome) "bin") "draft-loop-server.ps1"
  Write-Output "Replaced the owner token; the old one is refused from now on."
  Write-Output "Sign in again with the new one, which this prints: $script token"
}

switch ($Command) {
  "install" { Install-Server $Rest }
  "upgrade" { Update-Server $Rest }
  "up" { Start-Server }
  "down" { Invoke-Compose @("down") }
  "status" { Invoke-Compose @("ps") }
  "logs" { Invoke-Compose (@("logs", "--tail", "200") + $Rest) }
  "token" {
    if ($Rest.Count -eq 0) { Invoke-Compose @("exec", "-T", "api", "cat", "/secrets/owner_token") }
    elseif ($Rest.Count -eq 1 -and $Rest[0] -eq "--rotate") { Reset-OwnerToken }
    else { Fail "token takes no argument but --rotate." }
  }
  "backup" { Backup-Server $Rest }
  "restore" { Restore-Server $Rest }
  { $_ -in @("help", "--help", "-h") } { Show-Usage }
  default {
    Show-Usage | ForEach-Object { [Console]::Error.WriteLine($_) }
    exit 2
  }
}
