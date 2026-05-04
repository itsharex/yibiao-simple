param(
    [string]$SampleDir,
    [string]$OutDir,
    [int]$TimeoutSeconds = 900,
    [int]$IntervalSeconds = 5,
    [string]$ModelVersion = "vlm"
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$TestFilesName = "$([char]0x6D4B)$([char]0x8BD5)$([char]0x6587)$([char]0x4EF6)"
$CompareName = "$([char]0x5BF9)$([char]0x6BD4)$([char]0x7ED3)$([char]0x679C)"
if ([string]::IsNullOrWhiteSpace($SampleDir)) { $SampleDir = Join-Path $PSScriptRoot $TestFilesName }
if ([string]::IsNullOrWhiteSpace($OutDir)) { $OutDir = Join-Path $PSScriptRoot (Join-Path $CompareName "mineru-accurate") }

function Write-Log {
    param([string]$Message)
    Write-Host ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message)
}

if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$LogFile = Join-Path $OutDir "run.log"
Start-Transcript -Path $LogFile | Out-Null

try {
    $ProjectDir = Join-Path $PSScriptRoot "mineru-accurate-demo"
    Write-Log "MinerU accurate demo started"
    Write-Log "SampleDir=$SampleDir"
    Write-Log "OutDir=$OutDir"
    Write-Log "ProjectDir=$ProjectDir"
    Write-Log "timeout=$TimeoutSeconds interval=$IntervalSeconds model=$ModelVersion"

    if (!(Test-Path $SampleDir)) { throw "SampleDir not found: $SampleDir" }
    if (!(Test-Path $ProjectDir)) { throw "ProjectDir not found: $ProjectDir" }
    if (!(Test-Path (Join-Path $ProjectDir ".env"))) { throw "Missing .env in mineru-accurate-demo" }

    Push-Location $ProjectDir
    try {
        if (!(Test-Path "node_modules")) {
            Write-Log "node_modules not found, running npm install"
            npm install
        }
        npm run smoke -- "$SampleDir" --out-dir "$OutDir" --timeout $TimeoutSeconds --interval $IntervalSeconds --model-version $ModelVersion
        Write-Log "npm exit code: $LASTEXITCODE"
    } finally {
        Pop-Location
    }

    Write-Log "MinerU accurate demo finished"
} catch {
    Write-Log ("Failed: {0}" -f $_.Exception.Message)
    throw
} finally {
    Stop-Transcript | Out-Null
}
