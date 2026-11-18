[CmdletBinding()]
param([string]$ExpectedVersion='1.0.0-rc.3')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$root=([IO.DirectoryInfo](Resolve-Path (Join-Path $PSScriptRoot '..')).Path).FullName
$work=[IO.Path]::GetFullPath('E:\Temp')
if(-not [IO.Directory]::Exists($work)){throw 'Release check requires E:\Temp temporary storage'}
$env:TEMP=$work
$env:TMP=$work
$env:npm_config_cache=(Join-Path $work 'npm-cache')
$extract=Join-Path $work ('dsh-native-router-release-audit-'+[guid]::NewGuid().ToString('N'))
$packageJson=Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if($packageJson.name -ne 'dsh-native-router' -or $packageJson.version -ne $ExpectedVersion){
 throw ('Unexpected release package/version: '+$packageJson.name+'/'+$packageJson.version)
}
if($packageJson.private -ne $false){throw 'Release candidate must not be private'}
if($packageJson.license -ne 'MIT'){throw 'Public license metadata must be MIT'}
if($packageJson.engines.node -ne '>=22.10.0'){throw 'Source pack minimum supported Node version missing'}
foreach($hook in @('start','postinstall','preinstall')){
 if($packageJson.scripts.PSObject.Properties[$hook]){
  throw ('A native Cordis plugin cannot expose a '+$hook+' lifecycle script')
 }
}
$manifest=@('LICENSE','SECURITY.md','README.md','CHANGELOG.md','client.js','cordis.patch.yml',
 'src/index.mjs','src/host-failover.mjs','src/failover/state.mjs',
 'src/connection-routes.mjs','src/existing-dsh-channels.mjs',
 'docs/RELEASE_ACCEPTANCE.md','vendor/channel-pack/pack-native.js',
 'vendor/channel-pack/SOURCE_RECEIPT.json','vendor/channel-pack/NATIVE_BUILD_RECEIPT.json')
Push-Location $root
try {
 $stdout=& npm pack --json 2>&1
 if($LASTEXITCODE -ne 0){throw ('npm pack refused: '+(($stdout|Out-String).Substring(0,[Math]::Min(1000,($stdout|Out-String).Length))))}
 $packed=@(($stdout|Out-String|ConvertFrom-Json))
 if($packed.Count -ne 1){throw 'Exactly one archive expected'}
 $pkg=$packed[0]
 $archive=Join-Path $root $pkg.filename
 New-Item -ItemType Directory -Path $extract -Force|Out-Null
 & tar.exe -xzf $archive -C $extract
 if($LASTEXITCODE -ne 0){throw 'Cannot extract candidate tarball for audit'}
 $paths=@($pkg.files|ForEach-Object {$_.path})
 foreach($file in $manifest){
  if(-not ($paths -ccontains $file)){throw ('Missing mandatory release member '+$file)}
 }
 $deny='(^|/)(?:\.git|node_modules|\.env(?:\.[^/]*)?|config\.json|credentials?\.json|accounts?\.json|tokens?\.json|auth\.json|session\.json)(?:/|$)'
 if(@($paths|Where-Object {$_ -match $deny -or $_ -match '^(?:tools|tests)/' -or $_ -eq 'vendor/channel-pack/pack.js'}).Count){
  throw 'Archive contains original source, test helpers, config/secret files or runtime dependencies'
 }
 $count=0
 foreach($item in $pkg.files){
  $part=$item.path.Replace('/','\')
  $actual=Join-Path $root $part
  $unpacked=Join-Path (Join-Path $extract 'package') $part
  if(!(Test-Path -LiteralPath $actual -PathType Leaf)-or
     !(Test-Path -LiteralPath $unpacked -PathType Leaf)){
   throw ('Archive file missing from extracted source '+$part)
  }
  $left=(Get-FileHash -LiteralPath $actual -Algorithm SHA256).Hash
  $right=(Get-FileHash -LiteralPath $unpacked -Algorithm SHA256).Hash
  if($left -ne $right){throw ('Source/packaged SHA mismatch '+$part)}
  $count++
 }
  # Freeze upstream text as *Git canonical LF* on every platform. Do not
  # rewrite the binary WASM: binary CRLF bytes may be meaningful.
  function Get-CanonicalFingerprint([string]$FilePath,[bool]$Binary){
   [byte[]]$bytes=[IO.File]::ReadAllBytes([IO.Path]::GetFullPath($FilePath))
   if(-not $Binary){
    $text=[Text.Encoding]::UTF8.GetString($bytes).Replace("`r`n","`n")
    $bytes=[Text.Encoding]::UTF8.GetBytes($text)
   }
   $sha=[System.Security.Cryptography.SHA256]::Create()
   try {
    $hex=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
    return [pscustomobject]@{sha256=$hex;bytes=$bytes.Length}
   } finally {$sha.Dispose()}
  }
  $original=Get-Content 'vendor/channel-pack/SOURCE_RECEIPT.json' -Raw | ConvertFrom-Json
  $derivative=Get-Content (Join-Path $extract 'package/vendor/channel-pack/NATIVE_BUILD_RECEIPT.json') -Raw | ConvertFrom-Json
  $packed=(Get-CanonicalFingerprint 'vendor/channel-pack/pack.js' $false)
  if($packed.sha256 -ne $derivative.originalSha256){
   throw 'Pinned canonical LF MIT upstream source SHA mismatch'
  }
  if((Get-FileHash (Join-Path $extract 'package/vendor/channel-pack/pack-native.js') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $derivative.generatedSha256){
   throw 'Native source derivative SHA mismatch'
  }
  foreach($receipt in $original.referenceFiles){
   $ref=Join-Path 'vendor/channel-pack' $receipt.file
   $entry=Get-CanonicalFingerprint $ref ($receipt.file.EndsWith('.wasm'))
   if($entry.sha256 -ne $receipt.sha256.ToLowerInvariant() -or $entry.bytes -ne $receipt.bytes){
    throw ('Pinned canonical MIT source receipt drift '+$receipt.file)
   }
  }
 if($derivative.additionalRuntimeProcessRequired -ne $false){throw 'Extra runtime process forbidden'}
 $distribution=[pscustomobject]@{
  result='PASS'
  releaseStage='candidate-offline-verified'
  stableProductionAcceptance='PENDING_MANUAL_APPROVAL'
  archive=$archive
  version=$packageJson.version
  size=(Get-Item -LiteralPath $archive).Length
  sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  packagedFilesSHA256Verified=$count
  pinnedMITReferences=$original.referenceFiles.Count
  originalSha256=$derivative.originalSha256
  nativeSourceSha256=$derivative.generatedSha256
  private=$packageJson.private
  license=$packageJson.license
  nodeMinimum=$packageJson.engines.node
  independentRuntimeProcesses=0
  rawOriginalUpstreamIncluded=$false
  secretsOrDevelopmentToolsIncluded=$false
 }
 $distribution | ConvertTo-Json -Depth 5
}finally {
 Pop-Location
 Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
}
