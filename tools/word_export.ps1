param(
    [Parameter(Mandatory=$true)][string]$InputDocx,
    [Parameter(Mandatory=$true)][string]$OutputPdf
)
$ErrorActionPreference = 'Stop'
$inputPath = (Resolve-Path -LiteralPath $InputDocx).Path
if ([IO.Path]::GetExtension($inputPath) -ne '.docx') { throw 'Input must be a DOCX.' }
$sourceHash = (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash
$outputPath = [IO.Path]::GetFullPath($OutputPdf)
if ([IO.Path]::GetExtension($outputPath) -ne '.pdf') { throw 'Output must be a PDF.' }
if (Test-Path -LiteralPath $outputPath) { throw 'Output already exists.' }
if (Test-Path -LiteralPath "$outputPath.json") { throw 'Export metadata already exists.' }
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
$word = $null
$document = $null
$linksSetting = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3
    $linksSetting = $word.Options.UpdateLinksAtOpen
    $word.Options.UpdateLinksAtOpen = $false
    $document = $word.Documents.Open($inputPath, $false, $true, $false)
    $document.Repaginate()
    $document.ExportAsFixedFormat($outputPath, 17)
    if ((Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Source changed during export.' }
    $metadata = @{ renderer = 'Microsoft Word'; version = $word.Version; build = $word.Build;
       pages = $document.ComputeStatistics(2); pdf = $outputPath;
       sourceSha256 = $sourceHash;
       pdfSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash;
       fieldsUpdated = $false; sourceSaved = $false } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText("$outputPath.json", $metadata, (New-Object Text.UTF8Encoding($false)))
    $metadata
} finally {
    $dontSave = 0
    try {
        if ($null -ne $document) {
            $document.Close([ref]$dontSave)
            [Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null
        }
    } finally {
        if ($null -ne $word) {
            if ($null -ne $linksSetting) { $word.Options.UpdateLinksAtOpen = $linksSetting }
            $word.Quit([ref]$dontSave)
            [Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
        }
    }
}
