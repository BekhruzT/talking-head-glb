# Pulls a hand-picked subset of 3D-ETF (audio + ARKit blendshape pairs) out of
# the downloaded zip into inputs2/raw/. HDTF half only: long-form natural speech,
# one distinct speaker per clip, which is what the BEAT corpus gave us.
param(
  [string]$Zip = (Join-Path $env:USERPROFILE 'Downloads\3D-ETF.zip'),
  [string]$Out = (Join-Path $PSScriptRoot 'raw'),
  [switch]$All   # every HDTF clip, for screening, instead of the 10-clip sample
)

# 5 male / 5 female, spread across age and delivery, plus one radio voice.
$clips = @(
  'WDA_BarackObama_000'
  'WDA_HillaryClinton_000'
  'WDA_MichelleObama_000'
  'WDA_KirstenGillibrand_000'
  'WDA_DickDurbin_000'
  'WRA_CarlyFiorina_000'
  'WRA_PaulRyan0_001'
  'WRA_TimScott_000'
  'WRA_JoniErnst0_000'
  'RD_Radio11_000'
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$z = [System.IO.Compression.ZipFile]::OpenRead($Zip)
$byName = @{}
foreach ($e in $z.Entries) { $byName[$e.FullName] = $e }

if ($All) {
  $clips = $z.Entries |
    Where-Object { $_.FullName -like '3D-ETF/HDTF/audio/*.wav' } |
    ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.FullName) }
  Write-Output "extracting all $($clips.Count) HDTF clips"
}

foreach ($c in $clips) {
  foreach ($p in @("3D-ETF/HDTF/audio/$c.wav", "3D-ETF/HDTF/blendshape/$c.npy")) {
    $e = $byName[$p]
    if (-not $e) { Write-Output "MISSING $p"; continue }
    $dest = Join-Path $Out (Split-Path $p -Leaf)
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
    Write-Output ("ok {0,-34} {1,8:N0} KB" -f (Split-Path $p -Leaf), ($e.Length / 1KB))
  }
}
$z.Dispose()
