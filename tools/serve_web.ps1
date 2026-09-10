param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [int]$Port = 3001
)
$ErrorActionPreference = 'Stop'
$web = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../web'))
if (-not (Test-Path -LiteralPath (Join-Path $web '.next/BUILD_ID'))) { throw 'Run the production build first.' }
Set-Location -LiteralPath $web
while ($true) {
  & $NodePath 'node_modules/next/dist/bin/next' start --hostname 127.0.0.1 --port $Port
  Write-Warning 'Web server exited; restarting in 5 seconds.'
  Start-Sleep -Seconds 5
}
