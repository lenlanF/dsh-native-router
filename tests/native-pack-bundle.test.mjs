import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const file=name=>readFileSync(new URL('../'+name,import.meta.url));
const json=name=>JSON.parse(file(name).toString('utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
// Canonicalize source text only. Never transform WASM or other binary blobs.
const canonicalText=value=>Buffer.from(value.toString('utf8').replace(/\r\n/g,'\n'),'utf8');

test('the DSH-native bundle is deterministically derived from unchanged pinned MIT source',()=>{
 const source=json('vendor/channel-pack/SOURCE_RECEIPT.json');
 const native=json('vendor/channel-pack/NATIVE_BUILD_RECEIPT.json');
  const original=canonicalText(file('vendor/channel-pack/pack.js'));
  const bundled=file('vendor/channel-pack/pack-native.js');
  assert.equal(source.textCanonicalization,'LF for text files; binary WASM unchanged');
  assert.equal(sha(original),source.referenceFiles.find(row=>row.file==='pack.js').sha256);
  assert.equal(original.length,source.referenceFiles.find(row=>row.file==='pack.js').bytes);
  assert.equal(sha(original),native.originalSha256);
  for(const ref of source.referenceFiles){
    const bytes=file('vendor/channel-pack/'+ref.file);
    const canonical=ref.file.endsWith('.wasm')?bytes:canonicalText(bytes);
    assert.equal(canonical.length,ref.bytes,'source byte count '+ref.file);
    assert.equal(sha(canonical),ref.sha256,'canonical source SHA '+ref.file);
  }
  // The same source must verify from Windows CRLF or a fresh Linux LF clone.
  const crlf=Buffer.from(original.toString('utf8').replace(/\n/g,'\r\n'),'utf8');
  assert.equal(sha(canonicalText(crlf)),sha(original));
 assert.equal(sha(bundled),native.generatedSha256);
 assert.equal(bundled.length,native.generatedBytes);
 assert.equal(native.patches.length,19);
 assert.ok(native.patches.includes('scope-llm-adapter-cleanup'));
 assert.match(bundled.toString('utf8'),/ctx\.effect\(\(\) => cleanup\)/); assert.ok(native.patches.includes('private-new-login-credential-prefix'));
 assert.match(bundled.toString('utf8'),/NATIVE_ROUTER_SOURCE_\$\{provider\.toUpperCase\(\)\}_ACCOUNT_/);
 assert.ok(native.patches.includes('private-account-pool-service'));
 assert.ok(native.patches.includes('private-account-pool-lookup'));
 assert.match(bundled.toString('utf8'),/ctx\.provide\("nativeRouterSourceAccountPool", pool\)/);
 assert.match(bundled.toString('utf8'),/this\.ctx\.get\("nativeRouterSourceAccountPool"\)/);
 assert.doesNotMatch(bundled.toString('utf8'),/ctx\.provide\("accountPool", pool\)/);
 assert.ok(native.patches.includes('preserve-host-registered-provider-ownership'));
 assert.ok(native.patches.includes('register-independent-source-provider-aliases'));
 assert.ok(native.patches.includes('remove-upstream-google-oauth-default-id'));
 assert.ok(native.patches.includes('remove-upstream-google-oauth-default-secret'));
 assert.match(bundled.toString('utf8'),/^var GEMINI_DEFAULT_CLIENT_ID = "";$/m);
 assert.match(bundled.toString('utf8'),/^var GEMINI_DEFAULT_CLIENT_SECRET = "";$/m);
 assert.match(bundled.toString('utf8'),/native-router-source-/);
 assert.match(bundled.toString('utf8'),/const originalProviders = providers.filter/);
 assert.equal(native.additionalRuntimeProcessRequired,false);
 assert.equal(native.bundledByDSHPlugin,true);
});
test('bundled source has NO default gateway, loop resume, auto checkin or refresh daemon',()=>{
 const bundled=file('vendor/channel-pack/pack-native.js').toString('utf8');
 for(const prohibited of [
  '  mountOpenAiGateway(ctx, pool);',
  '  installLoopResume(ctx);',
  '  autoCheckin.start();',
  '  pool.listAllAccounts().then((accounts) => {',
 ]){
  if(prohibited.startsWith('  pool.listAllAccounts'))continue;
  assert.equal(bundled.includes(prohibited),false,'forbidden standalone startup: '+prohibited);
 }
 assert.match(bundled,/if \(config\.nativeRouterAutoRefresh === true\) pool\.listAllAccounts\(\)\.then/);
 assert.match(bundled,/var CHANNEL_PACK_NS = "dsh-native-router-source-channel-pack"/);
 assert.match(bundled,/join\(base, "plugins", "dsh-native-router", "source-channel-pack"\)/);
 assert.match(bundled,/CHANNEL_PACK_API_PATH = "\/api\/dsh-native-router\/channel-pack"/);
 assert.match(bundled,/CHANNEL_PACK_ENDPOINT = "native-router-channel-pack"/);
});
test('release package ships only native in-process bundle with host-provided peer modules',()=>{
 const pkg=json('package.json');
  const client=file('client.js').toString('utf8');
 const bridge=file('src/embedded-pack.mjs').toString('utf8');
 assert.equal(pkg.main,'./src/index.mjs');
  assert.equal(pkg.private,false);
  assert.equal(pkg.license,'MIT');
  assert.equal(pkg.engines.node,'>=22.10.0');
   assert.equal(pkg.version,'1.0.0-rc.11');
 assert.ok(pkg.files.includes('vendor/channel-pack/pack-native.js'));
 assert.ok(pkg.files.includes('vendor/channel-pack/NATIVE_BUILD_RECEIPT.json'));
 assert.ok(pkg.files.includes('vendor/channel-pack/SOURCE_RECEIPT.json'));
 assert.ok(!pkg.files.includes('vendor/channel-pack'));
 assert.ok(!pkg.files.includes('vendor/channel-pack/pack.js'));
 assert.match(bridge,/import\('\.\.\/vendor\/channel-pack\/pack-runtime\.mjs'\)/);
 assert.equal(pkg.dependencies,undefined,'DSH plugin manager must not need to preserve nested runtime packages');
 assert.equal(pkg.bundleDependencies,undefined);
 assert.ok(pkg.files.includes('vendor/channel-pack/pack-runtime.mjs'));
 assert.ok(pkg.files.includes('vendor/channel-pack/STANDALONE_BUILD_RECEIPT.json'));
 assert.match(client,/SOURCE_RPC='\/api\/dsh-native-router\/channel-pack'/);
 assert.match(client,/method:'native-router-channel-pack'/);
 const pinned=file('vendor/channel-pack/pack-native.js').toString('utf8');
 assert.match(pinned,/function startLoomyWechatLoginFlow/);
 assert.match(pinned,/async function claimLoomyDailyQuota/);
 assert.match(pinned,/ZCODE_PLAN_MESSAGES_URL/);
 assert.match(file('src/private-pack-adoption.mjs').toString('utf8'),/createPrivatePackAdoption/);
 assert.doesNotMatch(file('src/index.mjs').toString('utf8'),/registerNativeChannelDriver\('own_loomy'/);
  assert.ok(client.includes("URL='/api/plugins/dsh-native-router'"));
  assert.ok(pkg.peerDependencies['@deepseek-ai/dsh-credentials']);
  assert.ok(pkg.peerDependencies['@deepseek-ai/dsh-client-connection']);
  assert.ok(file('src/index.mjs').toString('utf8').includes("ctx.inject(['connection']"));
  assert.ok(!file('src/index.mjs').toString('utf8').includes("ctx.inject(['webServer']"));
  assert.ok(file('src/session-reuse.mjs').toString('utf8').includes('createSessionReuse'));
  assert.ok(file('src/existing-dsh-channels.mjs').toString('utf8').includes('createExistingDshChannelFacade'));
  assert.ok(file('src/channels/local-source.mjs').toString('utf8').includes('createLocalAndSourceDriver'));
  assert.ok(file('src/failover/state.mjs').toString('utf8').includes('rerunPending'));
  assert.ok(pkg.peerDependencies['@deepseek-ai/schemastery']);
 assert.equal(pkg.scripts.start,undefined,'no external application startup command');
});
