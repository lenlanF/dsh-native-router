"""Build/check the ONE-FILE, self-contained MIT source channel runtime.

Developer-only: the installed DSH plugin never executes this script or starts
an extra service. The build dependencies must be staged outside the user's
DSH profile, e.g. a disposable E:\\Temp directory. The immutable pinned MIT
snapshot and native source derivative are verified independently.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import shutil

ROOT=Path(__file__).resolve().parent.parent
VENDOR=ROOT/'vendor'/'channel-pack'
SOURCE=VENDOR/'pack-native.js'
NATIVE_RECEIPT=VENDOR/'NATIVE_BUILD_RECEIPT.json'
RUNTIME=VENDOR/'pack-runtime.mjs'
RECEIPT=VENDOR/'STANDALONE_BUILD_RECEIPT.json'
ESBUILD_VERSION='0.25.12'
DSH_LLM_VERSION='0.2.2-rc.3'
REQUIRED={
 '@deepseek-ai/cordis':'4.1.0',
 '@deepseek-ai/dsh-llm':DSH_LLM_VERSION,
 '@deepseek-ai/dsh-credentials':'0.2.2-rc.3',
 '@deepseek-ai/dsh-error':'0.2.2-rc.3',
 '@deepseek-ai/schemastery':'3.19.0',
}
REQUIRE='var { version } = createRequire(import.meta.url)("../package.json");'
REPLACEMENT='var version = "'+DSH_LLM_VERSION+'";'
def sha(data):return hashlib.sha256(data).hexdigest()
def verified_runtime(raw):
 text=raw.decode('utf8')
 if REQUIRE in text:raise SystemExit('Bundled runtime still has the DSH package.json require')
 # The only permitted external ESM imports are Node standard-library modules.
 bare=re.findall(r'(?m)^import .*? from ["\']([^"\']+)["\'];?',text)
 unsupported=[name for name in bare if not name.startswith('node:')]
 if unsupported:raise SystemExit('Standalone runtime contains nonbuilt-in ESM imports')
 if '@deepseek-ai/dsh-credentials' in '\n'.join(bare):
  raise SystemExit('Credentials package leaked into ESM imports')
 # GitHub push protection rejected the upstream Gemini OAuth defaults in rc10.
 # They must remain empty in BOTH distributed artifacts; only an owner-provided
 # local environment may supply these values at runtime.
 for key in ('GEMINI_DEFAULT_CLIENT_ID','GEMINI_DEFAULT_CLIENT_SECRET'):
  if not re.search(r'(?m)^var '+key+r' = "";$',text):
   raise SystemExit('Refuse to distribute upstream hardcoded Google OAuth default')
 return text
def verify():
 native=json.loads(NATIVE_RECEIPT.read_text('utf8'))
 receipt=json.loads(RECEIPT.read_text('utf8'))
 if receipt['nativeSourceSha256']!=native['generatedSha256'] or sha(SOURCE.read_bytes())!=native['generatedSha256']:
  raise SystemExit('Pinned native source derivative changed')
 if receipt['bundlerVersion']!=ESBUILD_VERSION or receipt['dshLlmVersion']!=DSH_LLM_VERSION:
  raise SystemExit('Pinned runtime compiler/version drift')
 if receipt['dependencies']!=REQUIRED or receipt.get('extraProcesses')!=0:
  raise SystemExit('Unexpected runtime dependency/proc manifest')
 data=RUNTIME.read_bytes()
 if sha(data)!=receipt['runtimeSha256'] or len(data)!=receipt['bytes']:
  raise SystemExit('Self-contained runtime SHA256 mismatch')
 verified_runtime(data)
 print(json.dumps({'result':'PASS','runtimeBytes':len(data),'sha256':sha(data),
                   'externalPackages':0,'extraProcesses':0,'check':True}))
def build(dependency_root:Path,esbuild_path:Path):
 dependency_root=dependency_root.resolve();esbuild_path=esbuild_path.resolve()
 # Refuse to stage tooling inside a user's persisted DSH profile.
 if '.dsh' in [p.lower() for p in dependency_root.parts] or not dependency_root.is_dir():
  raise SystemExit('Build dependencies must be in an independent temporary workspace')
 for name,version in REQUIRED.items():
  obj=json.loads((dependency_root/'node_modules'/name/'package.json').read_text('utf8'))
  if obj.get('version')!=version:raise SystemExit('Dependency version mismatch: '+name)
 compiler=subprocess.run([str(esbuild_path),'--version'],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=15)
 if compiler.returncode or compiler.stdout.strip()!=ESBUILD_VERSION:
  raise SystemExit('esbuild pinned compiler mismatch')
 native=json.loads(NATIVE_RECEIPT.read_text('utf8'))
 if sha(SOURCE.read_bytes())!=native['generatedSha256']:raise SystemExit('Native source receipt mismatch')
 entry=dependency_root/'native-router-pack-stage.js'
 outfile=dependency_root/'native-router-pack-standalone.mjs'
 if entry.exists():raise SystemExit('Refuse to overwrite an existing build input')
 try:
  # esbuild preserves this fixed basename in license/source attribution comments.
  entry.write_bytes(SOURCE.read_bytes())
  args=[str(esbuild_path),str(entry),'--bundle','--platform=node','--format=esm',
        '--target=node22','--legal-comments=inline','--log-level=error','--outfile='+str(outfile)]
  result=subprocess.run(args,cwd=dependency_root,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=100)
  if result.returncode:
    detail=' | '.join((result.stderr or '').splitlines()[:6])[:600]
    raise SystemExit('esbuild standalone compilation failed: '+detail)
  rendered=outfile.read_text('utf8')
  if rendered.count(REQUIRE)!=1:raise SystemExit('Pinned DSH package.json read anchor changed')
  rendered=rendered.replace(REQUIRE,REPLACEMENT,1)
  data=rendered.encode('utf8')
  verified_runtime(data)
  manifest={'kind':'single-file-in-process-channel-runtime',
    'nativeSourceSha256':native['generatedSha256'],'bundlerVersion':ESBUILD_VERSION,
    'dshLlmVersion':DSH_LLM_VERSION,'dependencies':REQUIRED,
    'runtimeFile':RUNTIME.name,'bytes':len(data),'runtimeSha256':sha(data),
    'extraProcesses':0,'independentCredentialStore':True,'noBareRuntimeImports':True}
  RUNTIME.write_bytes(data)
  RECEIPT.write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
 finally:
  entry.unlink(missing_ok=True)
  outfile.unlink(missing_ok=True)
 verify()
if __name__=='__main__':
 parser=argparse.ArgumentParser()
 parser.add_argument('--check',action='store_true')
 parser.add_argument('--dependencies',type=Path)
 parser.add_argument('--esbuild',type=Path)
 args=parser.parse_args()
 if args.check:verify()
 elif not args.dependencies or not args.esbuild:
  parser.error('Build requires --dependencies TEMP_WORKDIR and --esbuild COMPILER_PATH')
 else:build(args.dependencies,args.esbuild)
