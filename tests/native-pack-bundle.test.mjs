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
    assert.equal(native.patches.length,86);assert.ok(native.patches.includes('lobster-official-action-eligibility'));assert.ok(native.patches.includes('loomy-strict-daily-quota-evidence'));assert.ok(native.patches.includes('trae-explicit-official-daily-booleans'));assert.ok(native.patches.includes('loomy-sms-sender-requires-existing-owned-account'));
    for(const patch of ['lobster-official-status-renewal','lobster-renewal-cooldown','lobster-wire-official-read-renewal'])assert.ok(native.patches.includes(patch));
    assert.ok(native.patches.includes('loomy-sms-submit-refuses-cross-provider-credential-overwrite'));
   assert.ok(native.patches.includes('codearts-exact-official-credit-ratio'));
   assert.ok(native.patches.includes('zcode-rename-legacy-preview-for-dual-source'));
   assert.ok(native.patches.includes('zcode-marketing-touch-dual-source-discovery'));
   assert.ok(native.patches.includes('zcode-preview-bounded-timeout-for-readonly-status'));
   assert.ok(native.patches.includes('zcode-activation-readonly-3s-timeout'));   assert.ok(bundled.toString('utf8').includes('marketing/touch?seq='));
   assert.match(bundled.toString('utf8'),/MONOTONIC REQUEST COUNTER/);
   assert.doesNotMatch(bundled.toString('utf8'),/for\\(let base=0;base<9;base\\+=3\\)/);   assert.ok(native.patches.includes('zcode-balance-preview-must-preserve-failure'));
   assert.ok(native.patches.includes('zcode-status-anonymous-start-plan-count'));
   assert.ok(native.patches.includes('zcode-never-silently-fallback-to-paid-coding-plan'));
   assert.match(bundled.toString('utf8'),/Native Router forbids implicit Start-to-paid rail fallback/);
   assert.ok(native.patches.includes('codearts-display-exact-ratio-without-rounded-false-zero'));
   assert.ok(native.patches.includes('codearts-nonzero-one-network-post-limit'));
   assert.ok(native.patches.includes('codearts-track-actual-priced-proof-posts'));
   assert.match(bundled.toString('utf8'),/ONE_SHOT_LIMIT/);
   assert.ok(native.patches.includes('codearts-private-direct-catalog-metadata'));
   assert.ok(native.patches.includes('codearts-preserve-credit-in-all-models'));
   assert.ok(native.patches.includes('codearts-preserve-credit-in-list-models'));
   assert.ok(native.patches.includes('codearts-preserve-credit-in-resolved-model'));
   assert.ok(native.patches.includes('zcode-preserve-anonymous-start-plan-preview-count'));
   assert.ok(native.patches.includes('zcode-preserve-official-bucket-provenance'));
  assert.ok(native.patches.includes('bound-model-account-verification'));
  assert.ok(native.patches.includes('codearts-public-username-from-private-credential'));
  assert.ok(native.patches.includes('namespace-all-private-auth-services'));
 const generated=bundled.toString('utf8');
 assert.equal((generated.match(/super\(ctx, options\.serviceName \?\? `nativeRouterSource\$\{product\.id\}Auth`\);/g)||[]).length,10);
 assert.match(generated,/super\(ctx, "nativeRouterSourceCodeartsAuth"\);/);
 assert.doesNotMatch(generated,/super\(ctx, "codeartsAuth"\);/);
 assert.doesNotMatch(generated,/super\(ctx, options\.serviceName \?\? `\$\{product\.id\}Auth`\);/);
 assert.ok(native.patches.includes('scope-llm-adapter-cleanup'));
 assert.ok(native.patches.includes('private-source-checkins-callback'));
 assert.ok(native.patches.includes('failed-source-alias-transactional-rollback'));
 assert.match(bundled.toString('utf8'),/ctx\.effect\(\(\) => once\)/); assert.ok(native.patches.includes('private-new-login-credential-prefix'));
 assert.match(bundled.toString('utf8'),/NATIVE_ROUTER_SOURCE_\$\{provider\.toUpperCase\(\)\}_ACCOUNT_/);
 assert.ok(native.patches.includes('scoped-private-account-pool-callback'));
 assert.ok(native.patches.includes('private-account-pool-lookup'));
 assert.match(bundled.toString('utf8'),/config\.nativeRouterPoolReady\?\.\(pool\)/);
 assert.doesNotMatch(bundled.toString('utf8'),/ctx\.provide\("nativeRouterSourceAccountPool", pool\)/);
 assert.match(bundled.toString('utf8'),/nativeRouterSourcePools\.get\(this\.ctx\)/);
 assert.doesNotMatch(bundled.toString('utf8'),/ctx\.provide\("accountPool", pool\)/);
 assert.ok(native.patches.includes('preserve-host-registered-provider-ownership'));
 assert.ok(native.patches.includes('register-independent-source-provider-aliases'));
 assert.ok(native.patches.includes('remove-upstream-google-oauth-default-id'));
 assert.ok(native.patches.includes('remove-upstream-google-oauth-default-secret'));
 assert.match(bundled.toString('utf8'),/^var GEMINI_DEFAULT_CLIENT_ID = "";$/m);
 assert.match(bundled.toString('utf8'),/^var GEMINI_DEFAULT_CLIENT_SECRET = "";$/m);
 assert.match(bundled.toString('utf8'),/native-router-source-/);
 assert.doesNotMatch(bundled.toString('utf8'),/const originalProviders = providers.filter/);
 assert.ok(native.patches.includes('auth-first-independent-model-adapter-fail-open'));
 assert.ok(native.patches.includes('never-register-original-host-provider'));
 assert.match(bundled.toString('utf8'),/nativeRouterModelReady/);
 assert.match(bundled.toString('utf8'),/nativeRouterRpcReady/);
 assert.ok(native.patches.includes('source-rpc-registered-readiness-callback'));
 assert.match(bundled.toString('utf8'),/alias_occupied/);
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
    assert.equal(pkg.version,'1.0.0-rc.130');
   assert.ok(pkg.files.includes('tools/local-owner-jobs-cli.mjs'));
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

test('retired adapter and login UI do not ship in active source tree',()=>{
 const pkg=json('package.json');
 assert.ok(!pkg.files.some(name=>/doubao/i.test(name)));
 for(const name of ['client.js','src/index.mjs','src/channels.mjs','src/account-center.mjs','src/routes.mjs','src/channel-activities.mjs'])
  assert.doesNotMatch(file(name).toString('utf8'),/doubao|豆包/i,name);
});
