function Get-MangaPython {
    param([string]$Python)
    $mangaExplicit = $false
    if ($Python) {
        $mangaCandidates = @(@{Command=$Python; Prefix=@()})
        $mangaExplicit = $true
    } elseif ($env:MANGA_INTAKE_PYTHON) {
        $mangaCandidates = @(@{Command=$env:MANGA_INTAKE_PYTHON; Prefix=@()})
        $mangaExplicit = $true
    } else {
        $mangaCandidates = @(
            @{Command=(Join-Path $PSScriptRoot 'runtime\python\python.exe'); Prefix=@()},
            @{Command='py.exe'; Prefix=@('-3')},
            @{Command='python.exe'; Prefix=@()}
        )
    }
    foreach ($mangaCandidate in $mangaCandidates) {
        $mangaCommand = $mangaCandidate.Command
        if (Test-Path -LiteralPath $mangaCommand -PathType Leaf) {
            $mangaCommand = (Resolve-Path -LiteralPath $mangaCommand).Path
        } else {
            $mangaApplication = Get-Command -Name $mangaCommand -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $mangaApplication) { continue }
            $mangaCommand = $mangaApplication.Source
        }
        # Avoid launching the Microsoft Store's unconfigured execution alias.
        if ($mangaCommand -like '*\Microsoft\WindowsApps\*') { continue }
        $mangaPrefix = $mangaCandidate.Prefix
        try {
            $mangaResult = @(& $mangaCommand @mangaPrefix -B -X utf8 -c 'import sys; sys.exit(1) if sys.version_info < (3,12) else print(sys.executable)' 2>$null)
            if ($LASTEXITCODE -eq 0 -and $mangaResult.Count -eq 1 -and (Test-Path -LiteralPath $mangaResult[0] -PathType Leaf)) {
                return (Resolve-Path -LiteralPath $mangaResult[0]).Path
            }
        } catch {
            # Automatic discovery tries the next candidate; explicit choices fail below.
        }
    }
    if ($mangaExplicit) {
        throw 'The selected Python is unavailable or older than 3.12. Check -Python / MANGA_INTAKE_PYTHON.'
    }
    throw 'Python 3.12+ is required. Install Python, set MANGA_INTAKE_PYTHON, or restore runtime\python.'
}
