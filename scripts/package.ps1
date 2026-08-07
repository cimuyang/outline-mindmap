$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$manifestText = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw -Encoding UTF8
$version = ($manifestText | ConvertFrom-Json).version
$releaseDir = Join-Path $root "release"
$zipPath = Join-Path $releaseDir "outline-mindmap-$version.zip"
$artifacts = @(
	"main.js",
	"manifest.json",
	"styles.css",
	"LICENSE",
	"THIRD_PARTY_LICENSES.md"
)

foreach ($name in $artifacts) {
	$file = Join-Path $root $name
	if (-not (Test-Path -LiteralPath $file)) {
		throw "Missing build artifact: $file"
	}
}

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
Compress-Archive -LiteralPath ($artifacts | ForEach-Object { Join-Path $root $_ }) -DestinationPath $zipPath -Force
Write-Host "Created $zipPath"
