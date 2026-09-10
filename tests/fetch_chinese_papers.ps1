$ErrorActionPreference = 'Stop'
$sources = Get-Content (Join-Path $PSScriptRoot 'chinese_paper_sources.json') -Raw | ConvertFrom-Json
$destination = Join-Path $PSScriptRoot '../reports/real-papers'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$records = foreach ($source in $sources) {
    $tree = Invoke-RestMethod "https://api.github.com/repos/$($source.repo)/git/trees/$($source.tree_sha)?recursive=1" -HttpVersion 1.1 -MaximumRetryCount 3 -RetryIntervalSec 2
    $entry = $tree.tree | Where-Object path -eq $source.path
    if (-not $entry) { throw "Missing source: $($source.path)" }
    if ($entry.sha -ne $source.blob_sha) { throw "Unexpected blob: $($source.path)" }
    $target = Join-Path $destination $source.name
    if (-not (Test-Path -LiteralPath $target)) {
        $blob = Invoke-RestMethod $entry.url -HttpVersion 1.1 -MaximumRetryCount 3 -RetryIntervalSec 2
        if ($blob.encoding -ne 'base64') { throw 'Unexpected blob encoding' }
        [IO.File]::WriteAllBytes($target, [Convert]::FromBase64String($blob.content))
    }
    $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if ($hash -ne $source.sha256) { throw "Content hash mismatch: $target" }
    @{ file = $source.name; url = $entry.url; repository = "https://github.com/$($source.repo)"; tree_sha = $tree.sha; blob_sha = $entry.sha; sha256 = $hash; kind = 'public draft; publication and acceptance not verified' }
}
$records | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destination 'chinese-sources.json') -Encoding utf8
$records | ConvertTo-Json -Depth 4
