param(
 [string]$SandboxRoot='E:\Temp\dsh-native-router-isolated-alpha10-host',
 [string]$PortableNode='E:\Temp\dsh-native-router-isolated-alpha11-node-runtime\package\bin\node.exe',
 [switch]$SourcePool,
 [switch]$ExistingHost,
 [switch]$AgentLoop
)
$ErrorActionPreference='Stop'
if($AgentLoop -and $SandboxRoot -eq 'E:\Temp\dsh-native-router-isolated-alpha10-host'){
 $SandboxRoot='E:\Temp\dsh-native-router-agentloop-alpha18-host'
}
$root=[IO.Path]::GetFullPath($SandboxRoot).TrimEnd('\')
$parent=[IO.Path]::GetDirectoryName($root)
$name=[IO.Path]::GetFileName($root)
if((-not [string]::Equals($parent,'E:\Temp',[StringComparison]::OrdinalIgnoreCase)) -or
  ((-not $name.StartsWith('dsh-native-router-isolated-',[StringComparison]::OrdinalIgnoreCase)) -and
  (-not ($AgentLoop -and $name -eq 'dsh-native-router-agentloop-alpha18-host')))){
  throw 'Sandbox must be an explicit controlled E:\Temp\dsh-native-router-* directory'
}
if(!(Test-Path -LiteralPath $root -PathType Container)){throw 'Pre-created empty or controlled sandbox required'}
if(((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
 throw 'Sandbox may not be a directory junction/symlink'
}
$exe=[IO.Path]::GetFullPath($PortableNode)
if((-not $exe.StartsWith('E:\Temp\',[StringComparison]::OrdinalIgnoreCase)) -or
 (!(Test-Path -LiteralPath $exe -PathType Leaf))){throw 'Portable Node executable must be under E:\Temp'}
$version=& $exe -p 'process.versions.node'
if($LASTEXITCODE -ne 0 -or $version -notmatch '^(?:2[2-9]|[3-9][0-9])\.'){
 throw 'Portable Node 22+ with a supported modern runtime is required'
}
$required=if($AgentLoop){@('cordis','dsh-llm','dsh-agent-loop','dsh-agent','dsh-session','dsh-session-projection','dsh-tools')}else{@('cordis','dsh-llm','dsh-credentials','dsh-host-webserver')}
foreach($pkg in $required){
 if(!(Test-Path -LiteralPath (Join-Path $root ('node_modules\@deepseek-ai\'+$pkg)))){
  throw ('Required public DSH dependency missing in sandbox: '+$pkg)
 }
}
$ephemeral=$null
try {
 # Both native DSH and legacy upstream tests always use a fresh disposable
 # E:\Temp profile. Even apply() may touch state before the first test assertion.
  if((@($SourcePool,$ExistingHost,$AgentLoop)|Where-Object {$_}).Count -gt 1){throw 'Choose one isolated test scenario'}
  $kind=if($AgentLoop){'agentloop'}elseif($SourcePool){'pool'}elseif($ExistingHost){'existing-host'}else{'native'}
 $ephemeral=Join-Path 'E:\Temp' ('dsh-native-router-isolated-alpha13-'+$kind+'-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $ephemeral -Force|Out-Null
 Copy-Item -LiteralPath (Join-Path $root 'node_modules') -Destination $ephemeral -Recurse -Force
 [IO.File]::WriteAllText((Join-Path $ephemeral 'package.json'),'{"name":"isolated-dsh-native-router-test","private":true,"type":"module"}',[Text.UTF8Encoding]::new($false))
 $root=$ephemeral
$project=([IO.DirectoryInfo](Resolve-Path (Join-Path $PSScriptRoot '..')).Path).FullName
$sourceRoot=Join-Path $project 'src'
$targetRoot=Join-Path $root 'src'
foreach($file in Get-ChildItem -LiteralPath $sourceRoot -Recurse -File){
 $relative=$file.FullName.Substring($sourceRoot.Length).TrimStart('\')
 $target=Join-Path $targetRoot $relative
 New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($target))|Out-Null
 Copy-Item -LiteralPath $file.FullName -Destination $target -Force
}
$vendorTarget=Join-Path $root 'vendor\channel-pack'
New-Item -ItemType Directory -Path $vendorTarget -Force|Out-Null
foreach($file in @('pack.js','pack-native.js','qoder-auth-wasm.wasm')){
 Copy-Item -LiteralPath (Join-Path $project ('vendor\channel-pack\'+$file)) -Destination (Join-Path $vendorTarget $file) -Force
}
$toolDir=Join-Path $root 'tools'
New-Item -ItemType Directory -Path $toolDir -Force|Out-Null
 $script=if($AgentLoop){'verify-real-dsh-agentloop.mjs'}elseif($SourcePool){'verify-isolated-source-pool.mjs'}elseif($ExistingHost){'verify-existing-dsh-host-channels.mjs'}else{'verify-isolated-dsh-services.mjs'}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot $script) -Destination (Join-Path $toolDir $script) -Force
$env:TEMP='E:\Temp';$env:TMP='E:\Temp'
$env:DSH_HOME=$root;$env:DSH_CHANNEL_PACK_STATE_DIR=$root
$env:DSH_NATIVE_ROUTER_CHANNEL_PACK_ISOLATED_PROFILE='1'
$env:DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT='0'
if($SourcePool){
 $env:DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE='1'
 $env:DSH_OPENAI_GATEWAY_ENABLED='0';$env:DSH_REASONING_LOOP_AUTO_RESUME='0'
}else{
 Remove-Item Env:DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE,Env:DSH_OPENAI_GATEWAY_ENABLED,Env:DSH_REASONING_LOOP_AUTO_RESUME -ErrorAction SilentlyContinue
}
Push-Location $root
try{
 & $exe ('.\tools\'+$script)
 if($LASTEXITCODE -ne 0){throw ('Isolated DSH services validation failed: '+$LASTEXITCODE)}
}finally{Pop-Location}
}finally {
 if($ephemeral){
  # All synthetic AccountPool writes happened inside this exact new Profile.
  # Never remove any pre-existing source accounts or files.
  Remove-Item -LiteralPath $ephemeral -Recurse -Force -ErrorAction Stop
 }
}
