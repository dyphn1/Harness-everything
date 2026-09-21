$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
& node (Join-Path $scriptDir 'plugin-sync.js') @args
exit $LASTEXITCODE
