param(
    [string]$Root,
    [string]$LibraryRoot,
    [string]$Sources,
    [string]$CollectionAuthors,
    [switch]$SourcesOnly,
    [string]$Report,
    [string]$TorrentDir,
    [string]$CacheRoot,
    [string]$Python,
    [string[]]$CreatorAliases,
    [ValidateSet('zh','raw')][string]$TagLanguage = 'zh',
    [switch]$Offline,
    [switch]$Refresh,
    [switch]$DryRun,
    [switch]$PlanOnline,
    [switch]$PrefixedOnly,
    [switch]$MetadataOnly,
    [switch]$InPlace,
    [switch]$SeriesTags,
    [switch]$HashLookup,
    [ValidateSet('H','E')][string[]]$Library = @('H'),
    [switch]$NoSeriesMerge,
    [switch]$KeepDuplicates,
    [switch]$Help
)
$ErrorActionPreference = 'Stop'
# Code points keep the input folder name intact in Windows PowerShell 5.1 too.
$mangaIncomingName = -join ([char[]](0x3010,0x672A,0x5206,0x7C7B,0x3011))
if (($Root -or $LibraryRoot) -and $Library.Count -gt 1) {
    throw 'Use one library when specifying -Root or -LibraryRoot.'
}
. (Join-Path $PSScriptRoot 'runtime.ps1')
$mangaPython = Get-MangaPython -Python $Python
$mangaScript = Join-Path $PSScriptRoot 'scripts\daily_intake.py'
if ($Help) {
    & $mangaPython -B -X utf8 $mangaScript --help
    if ($LASTEXITCODE -ne 0) { throw 'Could not display help.' }
    return
}
if ($InPlace -and -not $Root) { throw 'Use -Root to select an existing library folder with -InPlace.' }
$mangaTargets = @()
if ($Root) {
    $mangaTargets += @{Root=$Root; LibraryRoot=$LibraryRoot}
} elseif ($LibraryRoot) {
    $mangaTargets += @{Root=(Join-Path $LibraryRoot $mangaIncomingName); LibraryRoot=$LibraryRoot}
} else {
    $mangaConfigPath = Join-Path $PSScriptRoot 'config.json'
    if (-not (Test-Path -LiteralPath $mangaConfigPath -PathType Leaf)) {
        throw 'Copy config.example.json to config.json and set your library paths, or pass -Root and -LibraryRoot.'
    }
    $mangaConfig = Get-Content -LiteralPath $mangaConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($mangaLibraryName in ($Library | Select-Object -Unique)) {
        $mangaLibraryRoot = $mangaConfig.libraries.$mangaLibraryName.root
        if (-not $mangaLibraryRoot) { throw ('Library is not configured: ' + $mangaLibraryName) }
        $mangaTargets += @{Root=(Join-Path $mangaLibraryRoot $mangaIncomingName); LibraryRoot=$mangaLibraryRoot}
    }
}
$mangaCommon = @('-B','-X','utf8',$mangaScript,'--tag-language',$TagLanguage)
foreach ($mangaOption in @(@('Sources','--sources'),@('CollectionAuthors','--collection-authors'),@('Report','--report'),@('TorrentDir','--torrent-dir'),@('CacheRoot','--cache-root'))) {
    $mangaValue = Get-Variable -Name $mangaOption[0] -ValueOnly
    if ($mangaValue) { $mangaCommon += @($mangaOption[1],$mangaValue) }
}
foreach ($mangaAlias in $CreatorAliases) { $mangaCommon += @('--creator-aliases',$mangaAlias) }
foreach ($mangaSwitch in @(@('Offline','--offline'),@('Refresh','--refresh'),@('DryRun','--dry-run'),@('PlanOnline','--plan-online'),@('PrefixedOnly','--prefixed-only'),@('MetadataOnly','--metadata-only'),@('InPlace','--in-place'),@('SeriesTags','--series-tags'),@('HashLookup','--hash-lookup'),@('SourcesOnly','--sources-only'),@('NoSeriesMerge','--no-series-merge'),@('KeepDuplicates','--keep-duplicates'))) {
    if (Get-Variable -Name $mangaSwitch[0] -ValueOnly) { $mangaCommon += $mangaSwitch[1] }
}
foreach ($mangaTarget in $mangaTargets) {
    $mangaArguments = $mangaCommon + @('--root',$mangaTarget.Root)
    if ($mangaTarget.LibraryRoot) { $mangaArguments += @('--library-root',$mangaTarget.LibraryRoot) }
    & $mangaPython @mangaArguments
    if ($LASTEXITCODE -ne 0) { throw ('Intake could not complete: ' + $mangaTarget.Root) }
}
