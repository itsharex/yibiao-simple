param(
    [string]$SampleDir,
    [string]$OutDir,
    [string]$BaseUrl = "http://127.0.0.1:18000",
    [int]$TimeoutSeconds = 300,
    [int]$MaxRetries = 3,
    [switch]$IncludeImages
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$TestFilesName = "$([char]0x6D4B)$([char]0x8BD5)$([char]0x6587)$([char]0x4EF6)"
$CompareName = "$([char]0x5BF9)$([char]0x6BD4)$([char]0x7ED3)$([char]0x679C)"
if ([string]::IsNullOrWhiteSpace($SampleDir)) { $SampleDir = Join-Path $PSScriptRoot $TestFilesName }
if ([string]::IsNullOrWhiteSpace($OutDir)) { $OutDir = Join-Path $PSScriptRoot (Join-Path $CompareName "python-docker") }

function Write-Log {
    param([string]$Message)
    Write-Host ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message)
}

function Invoke-ConvertWithRetry {
    param(
        [System.IO.FileInfo]$File,
        [string]$OutputFile,
        [string]$ErrorFile
    )

    $tempFile = "$OutputFile.tmp"
    if (Test-Path $tempFile) { Remove-Item $tempFile -Force }
    if (Test-Path $OutputFile) { Remove-Item $OutputFile -Force }
    if (Test-Path $ErrorFile) { Remove-Item $ErrorFile -Force }

    for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
        Write-Log ("{0}: attempt {1}/{2}, timeout={3}s" -f $File.Name, $attempt, $MaxRetries, $TimeoutSeconds)
        $includeImagesValue = $IncludeImages.IsPresent.ToString().ToLower()
        $curlArgs = @(
            "-sS",
            "--max-time", "$TimeoutSeconds",
            "-X", "POST",
            "$BaseUrl/convert",
            "-F", "file=@$($File.FullName)",
            "-F", "include_images=$includeImagesValue",
            "-o", "$tempFile",
            "-w", "%{http_code}"
        )

        $httpCode = & curl.exe @curlArgs 2>&1
        $curlExit = $LASTEXITCODE
        $httpCodeText = ($httpCode | Select-Object -Last 1).ToString().Trim()
        Write-Log ("{0}: curl_exit={1}, http={2}" -f $File.Name, $curlExit, $httpCodeText)

        if ($curlExit -eq 0 -and $httpCodeText -eq "200" -and (Test-Path $tempFile)) {
            Move-Item $tempFile $OutputFile -Force
            return @{ Status = "OK"; Message = ""; Bytes = (Get-Item $OutputFile).Length; Output = [System.IO.Path]::GetFileName($OutputFile) }
        }

        $errorBody = ""
        if (Test-Path $tempFile) { $errorBody = Get-Content $tempFile -Raw -Encoding UTF8 }
        $message = "attempt=$attempt curl_exit=$curlExit http=$httpCodeText body=$errorBody"
        $message | Out-File -FilePath $ErrorFile -Encoding UTF8

        if ($attempt -lt $MaxRetries) {
            $sleepSeconds = 5 * $attempt
            Write-Log ("{0}: sleep {1}s before retry" -f $File.Name, $sleepSeconds)
            Start-Sleep -Seconds $sleepSeconds
        }
    }

    if (Test-Path $tempFile) { Remove-Item $tempFile -Force }
    return @{ Status = "FAIL"; Message = (Get-Content $ErrorFile -Raw -Encoding UTF8); Bytes = (Get-Item $ErrorFile).Length; Output = [System.IO.Path]::GetFileName($ErrorFile) }
}

function Write-Summary {
    param([array]$Rows)
    $Rows | ConvertTo-Json -Depth 4 | Out-File -FilePath (Join-Path $OutDir "summary.json") -Encoding UTF8
    $lines = @("# Python Docker Result", "", "| File | Status | Output | Bytes | Message |", "| --- | --- | --- | ---: | --- |")
    foreach ($row in $Rows) {
        $message = ($row.Message -replace "\|", "\\|" -replace "`r?`n", " ")
        $lines += "| $($row.File) | $($row.Status) | $($row.Output) | $($row.Bytes) | $message |"
    }
    $lines | Out-File -FilePath (Join-Path $OutDir "summary.md") -Encoding UTF8
}

if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$LogFile = Join-Path $OutDir "run.log"
Start-Transcript -Path $LogFile | Out-Null

try {
    Write-Log "Python Docker demo started"
    Write-Log "SampleDir=$SampleDir"
    Write-Log "OutDir=$OutDir"
    Write-Log "BaseUrl=$BaseUrl"
    Write-Log "TimeoutSeconds=$TimeoutSeconds"
    Write-Log "MaxRetries=$MaxRetries"
    Write-Log "IncludeImages=$($IncludeImages.IsPresent)"

    if (!(Test-Path $SampleDir)) { throw "SampleDir not found: $SampleDir" }

    Write-Log "Warmup /openapi.json"
    for ($i = 1; $i -le $MaxRetries; $i++) {
        $warmup = & curl.exe -sS --max-time 30 -o NUL -w "%{http_code}" "$BaseUrl/openapi.json" 2>&1
        $warmupExit = $LASTEXITCODE
        Write-Log ("warmup {0}/{1}: curl_exit={2}, http={3}" -f $i, $MaxRetries, $warmupExit, $warmup)
        if ($warmupExit -eq 0 -and "$warmup" -eq "200") { break }
        Start-Sleep -Seconds (5 * $i)
    }

    $rows = @()
    $files = Get-ChildItem -Path $SampleDir -File | Sort-Object Name
    foreach ($file in $files) {
        $stem = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
        $outputFile = Join-Path $OutDir "$stem.md"
        $errorFile = Join-Path $OutDir "$stem.error.txt"
        $result = Invoke-ConvertWithRetry -File $file -OutputFile $outputFile -ErrorFile $errorFile
        $rows += [pscustomobject]@{ File = $file.Name; Status = $result.Status; Output = $result.Output; Bytes = $result.Bytes; Message = $result.Message }
        Write-Log ("{0} {1} -> {2}" -f $result.Status, $file.Name, $result.Output)
    }

    Write-Summary -Rows $rows
    Write-Log "Python Docker demo finished"
} catch {
    Write-Log ("Failed: {0}" -f $_.Exception.Message)
    throw
} finally {
    Stop-Transcript | Out-Null
}
