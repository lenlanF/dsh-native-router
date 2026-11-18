param(
 [string]$SandboxRoot='E:\Temp\dsh-native-router-isolated-alpha10-host',
 [string]$PortableNode='E:\Temp\dsh-native-router-isolated-alpha11-node-runtime\package\bin\node.exe',
 [switch]$ExperimentalMultiAccount
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($SandboxRoot).TrimEnd('\')
$parent=[IO.Path]::GetDirectoryName($root)
$name=[IO.Path]::GetFileName($root)
if((-not [string]::Equals($parent,'E:\Temp',[StringComparison]::OrdinalIgnoreCase)) -or (-not $name.StartsWith('dsh-native-router-isolated-',[StringComparison]::OrdinalIgnoreCase)))
{throw 'Refusing to use a directory outside E:\Temp\dsh-native-router-isolated-*'}
if(!(Test-Path -LiteralPath $root -PathType Container)){throw 'Create the isolated sandbox first'}
if(((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Refusing symbolic links or junctions as isolated DSH sandbox'}
$exe=[IO.Path]::GetFullPath($PortableNode)
if((-not $exe.StartsWith('E:\Temp\',[StringComparison]::OrdinalIgnoreCase)) -or (!(Test-Path -LiteralPath $exe -PathType Leaf))){throw 'Portable Node executable must exist under E:\Temp'}
$dependencies=Join-Path $root 'node_modules\@deepseek-ai\dsh-llm'
if(!(Test-Path -LiteralPath $dependencies)){throw 'Install pinned public DSH dependencies into the sandbox first'}
$src=Join-Path $root 'src'
$toolDir=Join-Path $root 'tools'
$vendor=Join-Path $root 'vendor\channel-pack'
New-Item -Path $src,$toolDir,$vendor -ItemType Directory -Force|Out-Null
$project=Resolve-Path (Join-Path $PSScriptRoot '..')
foreach($file in @('embedded-pack.mjs','channel-pack-isolation.mjs','source-account-ref.mjs','source-account-selection.mjs')){
 Copy-Item -LiteralPath (Join-Path $project ('src\'+$file)) -Destination (Join-Path $src $file) -Force
}
foreach($file in @('pack.js','pack-native.js','qoder-auth-wasm.wasm')){
 Copy-Item -LiteralPath (Join-Path $project ('vendor\channel-pack\'+$file)) -Destination (Join-Path $vendor $file) -Force
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'verify-isolated-cordis-host.mjs') -Destination (Join-Path $toolDir 'verify-isolated-cordis-host.mjs') -Force
$env:TEMP='E:\Temp';$env:TMP='E:\Temp'
$env:DSH_HOME=$root;$env:DSH_CHANNEL_PACK_STATE_DIR=$root
$env:DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE='1'
$env:DSH_NATIVE_ROUTER_CHANNEL_PACK_ISOLATED_PROFILE='1'
$env:DSH_OPENAI_GATEWAY_ENABLED='0'
$env:DSH_REASONING_LOOP_AUTO_RESUME='0'
$env:DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT=if($ExperimentalMultiAccount){'1'}else{'0'}
Push-Location $root
try{
 & $exe '.\tools\verify-isolated-cordis-host.mjs'
 if($LASTEXITCODE -ne 0){throw ('Isolated Cordis smoke failed with exit '+$LASTEXITCODE)}
}finally{Pop-Location}
