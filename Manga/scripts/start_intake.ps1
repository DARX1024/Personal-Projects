$ErrorActionPreference = 'Stop'
$mangaArguments = @($args)
try {
    $mangaProject = Split-Path -Parent $PSScriptRoot
    . (Join-Path $mangaProject 'runtime.ps1')
    $mangaPython = Get-MangaPython
    & $mangaPython -B -X utf8 (Join-Path $PSScriptRoot 'daily_intake.py') @mangaArguments
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
