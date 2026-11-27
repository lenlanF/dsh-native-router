"""Rebuild the self-contained DSH-native channel pack derivative.

This developer-only build tool is NOT needed when installing/running the
DSH plugin. Never change or overwrite the pinned MIT upstream snapshot.
"""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor" / "channel-pack"
UPSTREAM = VENDOR / "pack.js"
BUILT = VENDOR / "pack-native.js"
RECEIPT = VENDOR / "NATIVE_BUILD_RECEIPT.json"
SOURCE_RECEIPT = VENDOR / "SOURCE_RECEIPT.json"

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def build(*, check=False):
    source_manifest = json.loads(SOURCE_RECEIPT.read_text("utf8"))
    # Git stores the public text snapshot using LF. Windows can check it out
    # with CRLF, but the source identity must never depend on core.autocrlf.
    # Normalize TEXT only; qoder-auth-wasm.wasm remains strictly binary.
    original = UPSTREAM.read_bytes().replace(b"\r\n", b"\n")
    expected = next(entry["sha256"] for entry in source_manifest["referenceFiles"] if entry["file"] == "pack.js")
    if sha(original) != expected:
        raise SystemExit("Pinned canonical-LF source SHA256 mismatch: refuse to generate derivative")
    text = original.decode("utf8")
    patches = [
        (
            "var CHANNEL_PACK_NS = \"channel-pack\";",
            "var CHANNEL_PACK_NS = \"dsh-native-router-source-channel-pack\";",
            "private-settings-namespace",
        ),
        (
            'function resolveChannelPackHome(ctx) {\n'
            '  const override = process.env.DSH_CHANNEL_PACK_STATE_DIR;\n'
            '  if (override !== void 0 && override.trim().length > 0) return override.trim();\n'
            '  const profileHome = readService(ctx, "profileContext")?.home;\n'
            '  if (typeof profileHome === "string" && profileHome.length > 0) return profileHome;\n'
            '  const envHome = process.env.DSH_HOME;\n'
            '  if (envHome !== void 0 && envHome.trim().length > 0) return envHome.trim();\n'
            '  return join(homedir(), ".dsh");\n'
            '}',
            'function resolveChannelPackHome(ctx) {\n'
            '  const profileHome = readService(ctx, "profileContext")?.home;\n'
            '  const envHome = process.env.DSH_HOME;\n'
            '  const base = typeof profileHome === "string" && profileHome.length > 0 ? profileHome :\n'
            '    typeof envHome === "string" && envHome.trim().length > 0 ? envHome.trim() : join(homedir(), ".dsh");\n'
            '  // DSH-native plugin owns its source state. Never reuse another channel-pack profile.\n'
            '  return join(base, "plugins", "dsh-native-router", "source-channel-pack");\n'
            '}',
            "private-profile-subdirectory",
        ),
        (
            'var CHANNEL_PACK_API_PATH = "/api/channel-pack";',
            'var CHANNEL_PACK_API_PATH = "/api/dsh-native-router/channel-pack";',
            "private-connection-route",
        ),
        (
            'var CAPTCHA_CARRIER_PATH = "/api/channel-pack/captcha-carrier";',
            'var CAPTCHA_CARRIER_PATH = "/api/dsh-native-router/channel-pack/captcha-carrier";',
            "private-captcha-route",
        ),
        (
            'var CHANNEL_PACK_ENDPOINT = "channel-pack";',
            'var CHANNEL_PACK_ENDPOINT = "native-router-channel-pack";',
            "private-rpc-method",
        ),
        (
            '  const qoderFamily = [',
            '  // Dedicated in-process per-account claim/status bridge; never batch other accounts.\n'
            '  const nativeRouterCreditAccounts = async (req) => {\n'
            '    const accounts = await pool.listAccounts(req.provider);\n'
            '    if (req.accountId === void 0) return accounts;\n'
            '    if (typeof req.accountId !== "string" || !req.accountId) return [];\n'
            '    return accounts.filter((entry) => entry.id === req.accountId && entry.enabled === true);\n'
            '  };\n'
            '  ctx.provide("nativeRouterSourceCheckins", {\n'
            '    status: (provider, accountId) => handleMethod("credits.status", { provider, accountId }),\n'
            '    claim: (provider, accountId) => handleMethod("credits.claimAll", { provider, accountId })\n'
            '  });\n'
            '  const qoderFamily = [',
            "source-per-account-native-checkin-service",
        ),
        (
            'function registerAdapterIdempotent(llm, providers, adapter, warn) {\n'
            '  let target = wrapAdapterWithTokenLedger(providers, adapter);',
            'function registerAdapterIdempotent(llm, providers, adapter, warn) {\n'
            '  // Keep already registered DSH plugins as the sole owners of their providers.\n'
            '  // This source pack may still provide login for non-conflicting channels.\n'
            '  const registered = llm?.listProviders?.();\n'
            '  if (!Array.isArray(registered)) throw new Error("Host provider inventory unavailable");\n'
            '  const existing = new Set(registered.map((row) => typeof row === "string" ? row : row?.id ?? row?.provider));\n'
            '  providers = providers.filter((id) => !existing.has(id));\n'
            '  if (providers.length === 0) return void 0;\n'
            '  let target = wrapAdapterWithTokenLedger(providers, adapter);',
            'preserve-host-registered-provider-ownership',
        ),
        (
            '  ctx.provide("accountPool", pool);',
            '  config.nativeRouterPoolReady?.(pool);',
            'scoped-private-account-pool-callback',
        ),
        (
            'this.ctx.get("accountPool");',
            'nativeRouterSourcePools.get(this.ctx);',
            'private-account-pool-lookup',
        ),
        (
            'const refName = `${provider.toUpperCase()}_ACCOUNT_${suffix}`;',
            'const refName = `NATIVE_ROUTER_SOURCE_${provider.toUpperCase()}_ACCOUNT_${suffix}`;',
            'private-new-login-credential-prefix',
        ),
        (
            '  autoCheckin.start();',
            '  // Native Router owns opt-in daily check-in inside the same DSH plugin; no duplicate timer.',
            "remove-source-auto-checkin",
        ),
        (
            '  pool.listAllAccounts().then((accounts) => {',
            '  if (config.nativeRouterAutoRefresh === true) pool.listAllAccounts().then((accounts) => {',
            "disable-source-background-refresh-by-default",
        ),
        (
            '  mountOpenAiGateway(ctx, pool);',
            '  // Never launch upstream OpenAI 8326 gateway: DSH LlmRuntime is the only model entry point.',
            "remove-separate-openai-gateway",
        ),
        (
            '  installLoopResume(ctx);',
            '  // Native Router owns failover and DSH owns Agent lifetime; no second loop-resume listener.',
            "remove-duplicate-loop-resume",
        ),
    ]
    # Source pack already reads ZCode account labels; use its local credential
    # parser for CodeArts username as well. Expose only the public accountName,
    # never raw credential JSON or OAuth tokens. The source account record
    # itself may still be a temporary OAuth placeholder.
    patches.append((
        '    if (provider !== ZCODE.id) return [...accounts];',
        '''    if (provider === "codearts") {
      const out = [];
      for (const entry of accounts) {
        let accountName = "";
        try {
          const resolved = await ctx.credentials.resolve(credentialRef13(entry.credentialRef));
          const credential = resolved ? parseCodeArtsCredential(resolved.value) : null;
          if (typeof credential?.user_name === "string")
            accountName = credential.user_name.trim().slice(0,80);
        } catch {}
        out.push(accountName ? {...entry,accountName} : entry);
      }
      return out;
    }
    if (provider !== ZCODE.id) return [...accounts];''',
        "codearts-public-username-from-private-credential",
    ))
    # Avoid public Host service injection for data owned by this isolated pack.
    # Some DSH plugin profiles reject the added private service's registration
    # during apply(register_owned_adapter), even though the DSH llm service is
    # already present. Use the actual injected scope's WeakMap instead.
    patches.extend([
        (
            'var AccountPool = class {',
            'var nativeRouterSourcePools = new WeakMap();\nvar AccountPool = class {',
            'private-source-pool-scope-map',
        ),
        (
            '  const pool = new AccountPool(ctx);',
            '  const pool = new AccountPool(ctx);\n'
            '  nativeRouterSourcePools.set(ctx, pool);\n'
            '  ctx.effect(() => () => nativeRouterSourcePools.delete(ctx));',
            'bind-private-pool-to-injected-scope',
        ),
    ])
    patches.append((
        '  config.nativeRouterPoolReady?.(pool);',
        '  config.nativeRouterPoolReady?.(pool);\n'
        '  nativeSourceModelEligibility.set(ctx,config.nativeRouterModelEligibility);',
        'bound-model-account-verification',
    ))
    # This internal bridge is called by our own embedded-pack facade, and is
    # not registered as an extra service in the user's DSH root registry.
    old_checkins = (
        '  ctx.provide("nativeRouterSourceCheckins", {\n'
        '    status: (provider, accountId) => handleMethod("credits.status", { provider, accountId }),\n'
        '    claim: (provider, accountId) => handleMethod("credits.claimAll", { provider, accountId })\n'
        '  });'
    )
    new_checkins = (
        '  config.nativeRouterCheckinsReady?.({\n'
        '    status: (provider, accountId) => handleMethod("credits.status", { provider, accountId }),\n'
        '    balances: (provider) => handleMethod("credits.balances", { provider }),\n'
        '    identity: (provider) => handleMethod("account.list", { provider }),\n'
        '    claim: (provider, accountId) => handleMethod("credits.claimAll", { provider, accountId })\n'
        '  });'
    )
    patches.append((old_checkins,new_checkins,'private-source-checkins-callback'))
    # Preserve official provenance, rebuilding from the immutable MIT snapshot.
    patches.extend([
        (
            '  const ratio = codeArtsRatioLabel(m);\n'
            '  return { id, name: ratio === void 0 ? name2 : `${name2} · ${ratio}` };',
            r'''  const ratio = codeArtsRatioLabel(m);
  let exactRatio;
  for (const item of Array.isArray(m?.credit) ? m.credit : []) {
    const match = /^(\d+(?:\.\d+)?)\s*x$/i.exec(typeof item?.ratio_display === "string" ? item.ratio_display.trim() : "");
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isFinite(number) && number >= 0 && number <= 100) {
      exactRatio = number;
      break;
    }
  }
  return { id, name: ratio === void 0 ? name2 : `${name2} · ${ratio}`,
    catalogSource: "codearts-signed-official-model-catalog",
    catalogObservedAt: Date.now(),
    ...(exactRatio === void 0 ? {} : {
      costMultiplier: exactRatio, priceSource: "codearts-official-credit-ratio"
    }) };''',
            'codearts-exact-official-credit-ratio',
        ),
        (
            '        name: bucket.showName ?? result.planName ?? "ZCode \\u514D\\u8D39\\u989D\\u5EA6",',
            '        name: bucket.showName ?? result.planName ?? "ZCode \\u514D\\u8D39\\u989D\\u5EA6",\n'
            '        officialName: typeof bucket.showName === "string" ? bucket.showName : null,\n'
            '        officialPlanId: typeof bucket.planId === "string" ? bucket.planId : null,\n'
            '        officialUnitType: typeof bucket.unitType === "string" ? bucket.unitType : null,\n'
            '        officialMeter: typeof bucket.meter === "string" ? bucket.meter : null,',
            'zcode-preserve-official-bucket-provenance',
        ),
    ])

    # The upstream CodeArts adapter flattens official model data to {id,name}
    # after our parser extracts the signed response credit rate. Preserve the
    # vetted metadata all the way through listAllModels, listModels and
    # resolveModel, otherwise the owner directory sees 11 priced-unknown rows.
    patches.extend([
        (
            '      expiredTotal: 0,\n      packages\n    };',
            '      expiredTotal: 0,\n      packages,\n      // A preview does not prove current claim eligibility or funded balance.\n      previewStartPlanCount: Array.isArray(result.claimablePlans) ?\n        result.claimablePlans.filter(p => typeof p?.planId === "string" &&\n          /^zcode-v3-start-plan-[a-z0-9-]+$/i.test(p.planId)).length : null\n    };',
            'zcode-preserve-anonymous-start-plan-preview-count',
        ),
        (
            '    return source.filter((m) => !/-VL-/i.test(m.id) && !/-VL$/i.test(m.id)).map((m) => ({ id: m.id, name: m.name }));',
            '    return source.filter((m) => !/-VL-/i.test(m.id) && !/-VL$/i.test(m.id)).map((m) => ({ ...m, id: m.id, name: m.name }));',
            'codearts-preserve-credit-in-all-models',
        ),
        (
            '    return listed.map((m) => ({ provider: PROVIDER, id: m.id, name: m.name, inputModalities: this.inputModalitiesFor(m.id) }));',
            '    return listed.map((m) => ({ ...m, provider: PROVIDER, id: m.id, name: m.name, inputModalities: this.inputModalitiesFor(m.id) }));',
            'codearts-preserve-credit-in-list-models',
        ),
        (
            '    const resolved = { provider, id: model, name: name2 };',
            '    const resolved = { ...(remoteModel?.priceSource === "codearts-official-credit-ratio" && typeof remoteModel.costMultiplier === "number" ? {costMultiplier:remoteModel.costMultiplier, priceSource:remoteModel.priceSource} : {}), provider, id: model, name: name2 };',
            'codearts-preserve-credit-in-resolved-model',
        ),
    ])
    # A ZCode free Start Plan request MUST NOT silently retry against a
    # purchased Coding Plan after quota/rate errors. Even one unexpected retry
    # could consume paid credits while the native route is marked free-only.
    # Ordinary paid Coding Plan access remains an explicit account/model route;
    # no implicit cross-rail billing is permitted in this plugin.
    patches.append((
        '        if (shouldFallbackToOtherChannel(response.status, text) && !switchedAccount && captchaParam === void 0 && attempt < this.product.concurrencyRetryMax) {',
        '        if (false /* Native Router forbids implicit Start-to-paid rail fallback */ && shouldFallbackToOtherChannel(response.status, text) && !switchedAccount && captchaParam === void 0 && attempt < this.product.concurrencyRetryMax) {',
        'zcode-never-silently-fallback-to-paid-coding-plan',
    ))
    patches.append((
        'function fallbackToRemote(model) {',
        """async function nativeRouterLoomyCatalog(credential, signal) {
  if (typeof credential?.access_token !== "string" || !credential.access_token || signal?.aborted) return [];
  const timeout = AbortSignal.timeout(10000);
  const response = await fetch(`${LOOMY.apiBase}/models`, { headers: { Accept: "application/json", token: credential.access_token }, redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) return [];
  const rows = parseLoomyRemoteModels(await response.json());
  return rows.map(row => {
    const {rate} = splitLoomyRate(row.name);
    const value = /^x[0-9]+(?:[.][0-9]+)?$/i.test(rate) ? Number(rate.slice(1)) : NaN;
    return {id:row.id,name:row.name,catalogSource:"loomy-official-remote-model-catalog",catalogObservedAt:Date.now(),
      ...(Number.isFinite(value)&&value>=0&&value<=100?{costMultiplier:value,priceSource:"loomy-official-model-name-ratio",isFree:value===0}:{})};
  });
}
function fallbackToRemote(model) {""",
        'loomy-exact-account-remote-catalog',
    ))
    # The Host normalizes model lists and can remove exact CodeArts
    # credit rates. Scoped direct adapter catalog preserves official metadata.
    patches.append((
        '  });\n  const resolveBuddyCredentialByRef = async (refName) => {',
        '  });\n  config.nativeRouterSourceCatalogReady?.({\n'
        '    codearts: () => codearts.listModels("codearts"),\n'
        '    codeartsOneShot: request => codearts.stream({...request, nativeRouterOneShot: true}),\n'
        '    codeartsProfile: credential => nativeRouterCodeartsProfile(credential),\n'
        '    loomy: (credential, signal) => nativeRouterLoomyCatalog(credential, signal)\n'
        '  });\n  const resolveBuddyCredentialByRef = async (refName) => {',
        'codearts-private-direct-catalog-metadata',
    ))
    patches.append((
        '      if (Number.isFinite(value)) return `x${value.toFixed(2)}`;',
        '      if (Number.isFinite(value) && value >= 0 && value <= 100) return `x${value}`;',
        'codearts-display-exact-ratio-without-rounded-false-zero',
    ))
    # A paid owner probe is one upstream POST, not one SDK stream that can
    # silently send multiple POSTs on 401/429/errors or switch billable accounts.
    # Gate only the explicit private adapter request marker. Ordinary CodeArts
    # requests retain their original retries and fallback functionality.
    patches.append((
        '      headers.set("lang", "en");\n      response = await this.fetchImpl(url, {',
        '      headers.set("lang", "en");\n      if (options.nativeRouterOneShot === true && sentNativeRouterProofPosts++ > 0) {\n'
        '        throw new LlmError2("CodeArts native-router single POST limit", "ONE_SHOT_LIMIT");\n'
        '      }\n'
        '      response = await this.fetchImpl(url, {',
        'codearts-nonzero-one-network-post-limit',
    ))
    patches.append((
        '    let response;\n    let queueAttempts = 0;',
        '    let response;\n    let sentNativeRouterProofPosts = 0;\n    let queueAttempts = 0;',
        'codearts-track-actual-priced-proof-posts',
    ))
    # Signed ZCode preview can fail: unknown is NOT an empty claim list.
    patches.append((
        '    claimablePlans: await fetchClaimablePlans(credential, fetchImpl)',
        '    claimablePlans: await fetchZcodeClaimablePlans(credential, fetchImpl)',
        'zcode-balance-preview-must-preserve-failure',
    ))
    patches.append((
        '  return { active: true, todayCheckedIn: false, todayCredit: 0, claimable: plans.length > 0, planCount: plans.length, noClaimablePlans: plans.length === 0 };',
        '  return { active: true, todayCheckedIn: false, todayCredit: 0, claimable: plans.length > 0, planCount: plans.length, noClaimablePlans: plans.length === 0,\n'
        '    zcodeStartPlanCount: plans.filter(p => typeof p.planId === "string" && /^zcode-v3-start-plan-[a-z0-9-]+$/i.test(p.planId)).length };',
        'zcode-status-anonymous-start-plan-count',
    ))
    # 3.17+ delivers some no-charge Start Plan gifts ONLY through the
    # Marketing Touch banner feed (claim_zcode_plan). Keep the parser pure
    # and shared with independent fixture tests; inline its source into the
    # audited self-contained MIT derivative, never touch the upstream file.
    marketing_parser = (ROOT / "src" / "zcode-marketing-plans.mjs").read_text("utf8")
    if "import " in marketing_parser or marketing_parser.count("export function ") != 2:
        raise SystemExit("Unsafe changed marketing plan parser contract")
    marketing_parser = marketing_parser.replace("export function ", "function ")
    marketing_runtime = """
// Only authenticated read-only Marketing Touch discovery; no campaigns or
// credentials leave this private source pack. No automatic claim is made here.
let zcodeMarketingTouchSeq=0;
// Marketing Touch seq is a MONOTONIC REQUEST COUNTER, never a page number.
// The official 3.17+ client sends exactly ONE GET per refresh.
async function fetchZcodeMarketingTouchPlans(credential, fetchImpl = sanitizingFetch) {
  const oldVersion=String(credential.app_version??"");
  const numbers=oldVersion.split(".").slice(0,3).map(Number);
  const recent=numbers.length===3&&numbers.every(Number.isInteger)
    &&(numbers[0]>3||numbers[0]===3&&(
      numbers[1]>17||numbers[1]===17&&numbers[2]>=2));
  const context={...credential,app_version:recent?oldVersion:"3.17.2"};
  try{
    const seq=zcodeMarketingTouchSeq++;
    const response=await fetchWithTimeout(fetchImpl,
      `${ZCODE_ORIGIN2}/api/v1/marketing/touch?seq=${seq}`,{
      method:"GET",
      headers:buildZcodeHeaders(context,{json:false,
        authorization:`Bearer ${credential.zcode_jwt}`})
    },6500);
    if(!response.ok)return null;
    return parseZcodeMarketingPlans(await response.json());
  }catch{return null}
}const zcodeGrantReadInFlight=new Map();
async function fetchZcodeClaimablePlans(credential,fetchImpl=sanitizingFetch){
  const token=credential?.zcode_jwt;
  if(typeof token!=="string"||!token)return null;
  // Concurrent balance/status reads share one discovery request; the token
  // key is deleted as soon as it settles and is NEVER persisted/logged.
  const existing=zcodeGrantReadInFlight.get(token);
  if(existing)return existing;
  const read=Promise.all([
    fetchZcodeBillingPreviewPlans(credential,fetchImpl).catch(()=>null),
    fetchZcodeMarketingTouchPlans(credential,fetchImpl).catch(()=>null)
  ]).then(([preview,marketing])=>mergeZcodeClaimablePlans(preview,marketing,
      {marketingAuthoritative:true}));
  zcodeGrantReadInFlight.set(token,read);
  try{return await read}
  finally{if(zcodeGrantReadInFlight.get(token)===read)
    zcodeGrantReadInFlight.delete(token)}
}
"""
    patches.append((
        'async function fetchZcodeClaimablePlans(credential, fetchImpl = sanitizingFetch) {',
        'async function fetchZcodeBillingPreviewPlans(credential, fetchImpl = sanitizingFetch) {',
        'zcode-rename-legacy-preview-for-dual-source',
    ))
    patches.append((
        'async function claimZcodePlan(credential, planId, captcha, fetchImpl = sanitizingFetch) {',
        marketing_parser+"\n"+marketing_runtime+"\n"+
        'async function claimZcodePlan(credential, planId, captcha, fetchImpl = sanitizingFetch) {',        'zcode-marketing-touch-dual-source-discovery',
    ))
    patches.append((
        '  }, 25e3);',
        '  }, 5e3);',        'zcode-preview-bounded-timeout-for-readonly-status',
    ))
    # ZCode activation can block up to 40s while status polls bound at 18s.
    # Preserve activation but cap each best-effort event at 3 seconds.
    patches.append((
        '          app_version: appVersion\n        })\n      }, 2e4);',
        '          app_version: appVersion\n        })\n      }, 3e3);',
        'zcode-activation-readonly-3s-timeout',
    ))
    # Loomy backup SMS endpoints must be bound to an actual enabled Loomy
    # account before contacting the paid SMS provider or writing credentials.
    # Upstream v3.5.4 accepts arbitrary accountId in sendSms and then uses
    # that account's credentialRef in submitSms. A caller could otherwise
    # bind a Loomy session to another provider's credential reference.
    patches.extend([
        (
            '        const phone = typeof req.phone === "string" ? req.phone.trim() : "";',
            '        const smsAccount = pool.findAccount(req.accountId);\n'
            '        if (!smsAccount || smsAccount.provider !== LOOMY.id || smsAccount.enabled !== true) {\n'
            '          return { ok: false, error: { code: "loomy-account-mismatch", message: "The Loomy account must exist and be enabled" } };\n'
            '        }\n'
            '        const phone = typeof req.phone === "string" ? req.phone.trim() : "";',
            'loomy-sms-sender-requires-existing-owned-account',
        ),
        (
            '        const pending = pendingSmsMsgid.get(req.accountId);',
            '        const smsAccount = pool.findAccount(req.accountId);\n'
            '        if (!smsAccount || smsAccount.provider !== LOOMY.id || smsAccount.enabled !== true) {\n'
            '          return { ok: false, error: { code: "loomy-account-mismatch", message: "The Loomy account must exist and be enabled" } };\n'
            '        }\n'
            '        const pending = pendingSmsMsgid.get(req.accountId);',
            'loomy-sms-submit-refuses-cross-provider-credential-overwrite',
        ),
    ])
    # The upstream QR confirmation route has been retired. Delegate new logins
    # to this plugin's separately tested official browser authorize receiver.
    patches.append((
        'raccoonStarted = await raccoon.startLogin();',
        'if (typeof config.nativeRouterRaccoonLogin !== "function") throw new Error("raccoon-authorize-unavailable");\n            raccoonStarted = await config.nativeRouterRaccoonLogin();',
        'raccoon-official-browser-authorize',
    ))
    # Google explicitly disallows third-party clients accessing Code Assist
    # through the Gemini CLI OAuth grant. Do not keep offering a doomed login.
    patches.append((
        'const started = await startGeminiOAuthFlow({});\n          await pool.addAccount({',
        'return { ok: false, error: { code: "gemini-official-oauth-restricted", message: "Third-party Code Assist OAuth is not supported" } };\n          const started = await startGeminiOAuthFlow({});\n          await pool.addAccount({',
        'gemini-reject-restricted-third-party-oauth',
    ))
    # Exact-account read-only status and balance for selected authentication.
    patches.append((
        'balances: (provider) => handleMethod("credits.balances", { provider }),\n    identity: (provider) => handleMethod("account.list", { provider }),',
        'balances: (provider, accountId) => handleMethod("credits.balances", { provider, accountId }),\n    identity: (provider, accountId) => handleMethod("account.list", { provider, accountId }),',
        'source-exact-account-status-contract',
    ))
    for method in ("credits.balances", "account.list"):
        patches.append((
            'case "' + method + '": {\n        const req = payload;\n        const accounts = await pool.listAccounts(req.provider);',
            'case "' + method + '": {\n        const req = payload;\n        const accounts = await nativeRouterCreditAccounts(req);',
            'source-exact-account-' + method,
        ))
    # TRAE consumer credits: never count expired entitlements, unknown usage
    # or an unlimited sentinel as a finite spendable balance.
    patches.append((
        'const creditsLimit = readNumber9(quota, "credits_limit");\n    if (creditsLimit <= 0) continue;\n    const usage = entry.usage;\n    const used = typeof usage === "object" && usage !== null ? readNumber9(usage, "credits_amount") : 0;\n    const expireSec = readNumber9(entry, "expire_time");\n    const deductionEndMs = expireSec > 0 ? expireSec * 1e3 : void 0;',
        '''const creditsLimit = quota.credits_limit;
    const used = entry.usage?.credits_amount;
    const expireSec = entry.expire_time;
    if (typeof creditsLimit !== "number" || !Number.isFinite(creditsLimit) || creditsLimit < 0 || creditsLimit > 1e12 || typeof used !== "number" || !Number.isFinite(used) || used < 0 || used > creditsLimit || !Number.isSafeInteger(expireSec) || expireSec <= 0 || expireSec > 253402300799) return null;
    const deductionEndMs = expireSec * 1e3;
    if (deductionEndMs <= Date.now()) {
      expiredTotal += creditsLimit - used;
      continue;
    }''',
        'trae-reconciled-active-credit-entitlements',
    ))
    patches.append((
        'expiredTime: "",\n      ...deductionEndMs !== void 0 ? { deductionEndTime: deductionEndMs } : {}',
        'expiredTime: new Date(deductionEndMs).toISOString(),\n      deductionEndTime: deductionEndMs',
        'trae-official-credit-expiry',
    ))
    # TRAE must provide both official booleans, not inferred defaults.
    patches.append((
        'async function fetchTraeCheckinStatus(credential, _product, fetcher = sanitizingFetch) {\n  const result = await postJson3(TRAE_CHECKIN_STATUS_PATH, credential, "{}", fetcher, credential.uid);\n  if (!result.ok) return null;\n  const body = result.body;\n  const code = readClaimCode(body);\n  if (code !== 0) return null;',
        'async function fetchTraeCheckinStatus(credential, _product, fetcher = sanitizingFetch) {\n  const result = await postJson3(TRAE_CHECKIN_STATUS_PATH, credential, "{}", fetcher, credential.uid);\n  if (!result.ok) return null;\n  const body = result.body;\n  const code = readClaimCode(body);\n  if (code !== 0 || typeof body.enable !== "boolean" || typeof body.checked_in !== "boolean") return null;',
        'trae-explicit-official-daily-booleans',
    ))
    # Keep the existing signed package response's plan facts. Missing credit
    # metrics must not become a fabricated zero or a sum of overlapping rows.
    patches.append((
        '  let sawAnyCreditMetric = false;\n  for (const item of metrics) {',
        '  const seenCreditMetrics = new Set();\n  const strictCredit = v => (typeof v === "number" || typeof v === "string" && /^\\d+(?:\\.\\d+)?$/.test(v.trim())) && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1e12 ? Number(v) : null;\n  for (const item of metrics) {',
        'codearts-strict-credit-metric-input',
    ))
    patches.append((
        '    sawAnyCreditMetric = true;\n    const amount = readNumber8(record, "package_credit_amount");\n    const used = readNumber8(record, "package_credit_used");\n    const remain = readNumber8(record, "package_credit_remain");\n    if (name2 === TOTAL_CREDIT_METRIC) totalRemain = remain;\n    if (amount <= 0 && remain <= 0) continue;',
        '    if (seenCreditMetrics.has(name2)) return void 0;\n    seenCreditMetrics.add(name2);\n    const amount = strictCredit(record.package_credit_amount);\n    const used = strictCredit(record.package_credit_used);\n    const remain = strictCredit(record.package_credit_remain);\n    if (amount === null || used === null || remain === null || remain > amount) return void 0;\n    if (name2 === TOTAL_CREDIT_METRIC) totalRemain = remain;',
        'codearts-strict-credit-metric-values',
    ))
    patches.append((
        '  if (!sawAnyCreditMetric) return void 0;\n  const total = roundCredits3(\n    totalRemain ?? packages.reduce((sum, pkg) => sum + pkg.remaining, 0)\n  );',
        '  if (totalRemain === void 0) return void 0;\n  const total = roundCredits3(totalRemain);',
        'codearts-require-explicit-total-credit',
    ))
    patches.append((
        '      packageStatus: readString6(pkg, "status"),\n      credit: parseCreditBalance(data.metrics)',
        '      packageStatus: readString6(pkg, "status"),\n      officialPlan: {name:packageNameCn.length > 0 ? packageNameCn : packageNameEn,status:readString6(pkg,"status"),credit:typeof pkg.is_credit_package === "boolean" ? pkg.is_credit_package : null,token:typeof pkg.is_token_package === "boolean" ? pkg.is_token_package : null},\n      credit: parseCreditBalance(data.metrics)',
        'codearts-explicit-plan-flags',
    ))
    patches.append((
        '              return { balance: info.credit };',
        '              return { balance: {...info.credit,codeartsPlan:info.officialPlan} };',
        'codearts-retain-official-plan-facts',
    ))
    # The documented IAM self-detail API is a separate, read-only source of
    # identity when CodeArts login returned an explicit user ID but no name.
    # No retries, redirects, privilege changes or token export.
    patches.append((
        'async function fetchCodeArtsAccountInfoDetailed(credential, fetcher = directFetch, renew) {',
        """async function nativeRouterCodeartsProfile(credential, fetcher = directFetch) {
  const id = nativeRouterLoginId(credential?.user_id);
  if (!credential?.access_key_id || !credential.secret_access_key || !credential.security_token) return null;
  const nameOf = user => {
    const name = nativeRouterLoginPublicName(user);
    return name && !/::|^urn:|^hw[0-9a-f]{6,}$|^[0-9a-f]{8}-[0-9a-f]{4}-|^[0-9a-f]{16,}$/i.test(name) ? {accountName:name} : null;
  };
  const read = async (url, extra = {}) => {
    try {
      const signed = await signRequestHuawei(credential.access_key_id, credential.secret_access_key, credential.security_token, "GET", url, new Uint8Array());
      signed.delete("host");
      const headers = new Headers(Object.fromEntries(signed));
      for (const [key, value] of Object.entries(extra)) headers.set(key, value);
      const res = await fetcher(url, {method:"GET",headers,signal:AbortSignal.timeout(4000),redirect:"error"});
      if (!res.ok) return null;
      const doc = await res.json();
      if (!doc || typeof doc !== "object" || (doc.code !== undefined && ![0,200,"0","200"].includes(doc.code)) || doc.error_code) return null;
      return doc;
    } catch { return null; }
  };
  // Reference: magpie-community/plugins packages/codearts, MIT, current/user.
  // Use the current authorized account's signed self endpoint, not a guessed IAM ID.
  const profile = await read(CODEARTS_SNAP_ENGINE_URL + "/snap-manager/v1/current/user", SNAP_EXTRA_HEADERS);
  if (profile) {
    const user = profile.data ?? profile;
    const subject = nativeRouterLoginId(user?.user_id,user?.userId);
    if (subject === null || (id && subject && subject !== id)) return null;
    if (subject) {
      const name = nameOf(user);
      if (name) return name;
    }
  }
  if (!id) return null;
  const data = await read("https://iam.myhuaweicloud.com/v3/users/" + encodeURIComponent(id));
  return data?.user?.id === id ? nameOf(data.user) : null;
}
async function fetchCodeArtsAccountInfoDetailed(credential, fetcher = directFetch, renew) {""",
        'codearts-official-iam-self-profile',
    ))
    # Preserve actual public profile fields from the authenticated login response.
    patches.append((
        'domain_id: data.domain_id ?? "",\n        user_id: data.user_id ?? "",\n        user_name: data.user_name ?? ""',
        'domain_id: nativeRouterLoginId(data.domain_id, data.domainId, data.credential.domain_id, data.credential.domainId) ?? "",\n        user_id: nativeRouterLoginId(data.user_id, data.userId, data.credential.user_id, data.credential.userId) ?? "",\n        user_name: nativeRouterLoginId(data.user_id, data.userId, data.credential.user_id, data.credential.userId) === null ? "" : nativeRouterLoginPublicName(data, data.credential)',
        'codearts-login-public-profile-aliases',
    ))
    patches.append((
        'expires_at: data.result.expiration ?? data.result.expiresAt ?? ""',
        'expires_at: data.result.expiration ?? data.result.expiresAt ?? "",\n        user_id: nativeRouterLoginId(data.result.user_id, data.result.userId, data.user_id, data.userId) ?? "",\n        domain_id: nativeRouterLoginId(data.result.domain_id, data.result.domainId, data.domain_id, data.domainId) ?? "",\n        user_name: nativeRouterLoginId(data.result.user_id, data.result.userId, data.user_id, data.userId) === null ? "" : nativeRouterLoginPublicName(data.result, data)',
        'codearts-result-login-retain-identity',
    ))
    patches.append((
        'function parseCredentialResponse(data) {',
        """function nativeRouterLoginId(...values) {
  const ids = [...new Set(values.filter(v => typeof v === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(v)))];
  return ids.length > 1 ? null : ids[0];
}
function nativeRouterLoginPublicName(...sources) {
  for (const root of sources) {
    for (const obj of [root, root?.user, root?.profile, root?.account, root?.userInfo, root?.user_info]) {
      for (const key of ["displayName", "display_name", "nickname", "nickName", "user_name", "userName", "username", "account_name", "accountName", "name", "email"]) {
        const v = obj?.[key];
        if (typeof v !== "string") continue;
        const name = v.trim();
        if (name && name.length <= 120 && name !== obj?.id && name !== obj?.user_id && name !== obj?.userId && !/^(?:hid_|device[_-]|账号\\s*\\d+|[0-9a-f]{24,})/i.test(name) && !/[\\x00-\\x1f]/.test(name)) return name;
      }
    }
  }
  return "";
}
function parseCredentialResponse(data) {""",
        'login-safe-public-identity-helper',
    ))
    patches.append((
        'const displayName = typeof data.user?.name === "string" && data.user.name.length > 0 ? data.user.name : typeof data.user?.email === "string" && data.user.email.length > 0 ? data.user.email : userId;',
        'const displayName = nativeRouterLoginPublicName(data.user, data.profile, data.userInfo, data.user_info);',
        'zcode-login-name-not-opaque-id',
    ))
    patches.append((
        'if (response.status === 401 || response.status === 403) {\n          await response.body?.cancel();\n          credential = await this.options.refresh(accountId || void 0) ?? await this.options.resolveCredential(options.model);\n          if (credential === void 0 || credential.access_token.length === 0) {\n            throw new LlmError10',
        'if (response.status === 401) {\n          await response.body?.cancel();\n          credential = await this.options.refresh(accountId || void 0) ?? await this.options.resolveCredential(options.model);\n          if (credential === void 0 || credential.access_token.length === 0) {\n            throw new LlmError10',
        'loomy-no-refresh-replay-on-forbidden',
    ))
    patches.append((
        'throw new LlmError10(\n            `loomy: ${errorDetail4(errorText)}`,\n            quota ? "QUOTA_EXCEEDED" : httpErrorCode4(response.status),\n            { status: response.status }\n          );',
        'const retryAfterMs = response.status === 429 ? retryAfterMsFromResponse(response.headers) : void 0;\n          throw Object.assign(new LlmError10(\n            `loomy: ${errorDetail4(errorText)}`,\n            quota ? "QUOTA_EXCEEDED" : httpErrorCode4(response.status),\n            { status: response.status }\n          ), Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? { retryAfterMs: Math.min(retryAfterMs, 86400000), providerRetryAfterMs: Math.min(retryAfterMs, 86400000) } : {});',
        'loomy-preserve-http-retry-after',
    ))
    patches.append((
        'const resetAt = error.code === "QUOTA_EXCEEDED" ? nextUtc8DayStartMs() : Date.now() + 6e4;\n          await this.options.accountPool?.updateModelRateLimit(accountId, options.model, resetAt);\n        }\n        if (emitted || attempt === 2 || this.options.nextAccount === void 0) throw error;\n        const next = await this.options.nextAccount(options.model, tried);\n        if (next === void 0 || tried.has(next.accountId)) throw error;\n        accountId = next.accountId;\n        credential = next.credential;\n        if (isLoomyExpired(credential)) credential = await this.options.refresh(accountId) ?? credential;',
        'const resetAt = error.code === "QUOTA_EXCEEDED" ? nextUtc8DayStartMs() : Date.now() + Math.max(6e4, Number.isFinite(error.retryAfterMs) ? Math.min(error.retryAfterMs, 86400000) : 0);\n          await this.options.accountPool?.updateModelRateLimit(accountId, options.model, resetAt);\n        }\n        if (emitted || attempt === 2 || this.options.nextAccount === void 0) throw error;\n        const next = await this.options.nextAccount(options.model, tried);\n        if (next === void 0 || tried.has(next.accountId)) throw error;\n        accountId = next.accountId;\n        credential = next.credential;\n        if (isLoomyExpired(credential)) credential = await this.options.refresh(accountId) ?? credential;',
        'loomy-rate-window-honors-official-delay',
    ))
    # Preserve explicit official daily quota accounting; reject missing/null
    # numeric fields that the vendor's generic Number() coerces to zero.
    patches.append((
        'async function fetchLoomyCreditDetail(credential, product, fetcher = sanitizingFetch) {',
        '''function nativeRouterLoomyWalletNumber(value) {
  return (typeof value === "number" || typeof value === "string" && /^[0-9]+(?:\\.[0-9]+)?$/.test(value)) && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e12 ? Number(value) : void 0;
}
function nativeRouterLoomyDailyEvidence(data) {
  const n = nativeRouterLoomyWalletNumber;
  const quota = n(data?.dailyQuota), balance = n(data?.dailyBalance), consumed = n(data?.dailyConsumed);
  const limit = n(data?.dailyLimitPoints), remaining = n(data?.dailyRemainingPoints);
  const hasPair = data?.dailyLimitPoints !== void 0 || data?.dailyRemainingPoints !== void 0;
  if (hasPair) {
    if (!(limit > 0) || remaining === void 0 || remaining > limit) return void 0;
    if (data?.dailyQuota !== void 0 && (quota === void 0 || Math.abs(quota-limit)>=1e-6) || data?.dailyBalance !== void 0 && (balance === void 0 || Math.abs(balance-remaining)>=1e-6) || data?.dailyConsumed !== void 0 && (consumed === void 0 || Math.abs(consumed-(limit-remaining))>=1e-6)) return void 0;
    return { quota:limit,balance:remaining,consumed:limit-remaining };
  }
  if (!(quota > 0) || balance === void 0 || consumed === void 0 || Math.abs(balance + consumed - quota) >= 1e-6) return void 0;
  return { quota, balance, consumed };
}
async function fetchLoomyCreditDetail(credential, product, fetcher = sanitizingFetch) {''',
        'loomy-strict-daily-quota-evidence',
    ))
    patches.append((
        'const permanent = readNumber(result.data?.balance);\n  const daily = readNumber(result.data?.dailyBalance);\n  const available2 = readNumber(result.data?.availableBalance);\n  if (permanent === void 0) return null;\n  const total = available2 ?? permanent + (daily ?? 0);',
        '''const data = result.data;
  const n = nativeRouterLoomyWalletNumber;
  const permanent = n(data?.balance);
  const evidence = nativeRouterLoomyDailyEvidence(data);
  const hasPair = data?.dailyLimitPoints !== void 0 || data?.dailyRemainingPoints !== void 0;
  const daily = hasPair ? evidence?.balance : n(data?.dailyBalance);
  const available2 = n(data?.availableBalance);
  if (permanent === void 0 || daily === void 0 || data?.availableBalance !== void 0 && available2 === void 0) return null;
  const total = available2 ?? permanent + daily;
  if (Math.abs(total-permanent-daily)>=1e-6) return null;''',
        'loomy-strict-wallet-reconciliation',
    ))
    patches.append((
        'dailyConsumed: readNumber(result.data?.dailyConsumed),\n    dailyCycleDate:',
        'dailyConsumed: readNumber(result.data?.dailyConsumed),\n    dailyQuotaEvidence: nativeRouterLoomyDailyEvidence(result.data),\n    dailyCycleDate:',
        'loomy-wallet-daily-evidence',
    ))
    patches.append((
        'claimable: !claimedToday,\n    dailyCycleDate: cycle',
        'claimable: !claimedToday,\n    dailyQuotaEvidence: detail.dailyQuotaEvidence,\n    dailyCycleDate: cycle',
        'loomy-status-daily-evidence',
    ))
    patches.append((
        'const alreadyProcessed = result.data?.alreadyProcessed === true;\n  if (alreadyProcessed) {',
        'const alreadyProcessed = result.data?.alreadyProcessed === true;\n  const dailyEvidence = nativeRouterLoomyDailyEvidence(result.data);\n  const dailyInitialization = dailyEvidence && typeof result.data?.alreadyProcessed === "boolean" ? { ...dailyEvidence, alreadyProcessed } : void 0;\n  if (alreadyProcessed) {',
        'loomy-first-login-official-receipt',
    ))
    patches.append((
        'kind: "already-claimed",\n      message: dailyQuota ===',
        'kind: "already-claimed",\n      dailyInitialization,\n      message: dailyQuota ===',
        'loomy-already-initialized-receipt',
    ))
    patches.append((
        'return { kind: "claimed", credit: granted, streakDays: 0, isStreakDay: false };',
        'return { kind: "claimed", credit: granted, streakDays: 0, isStreakDay: false, dailyInitialization };',
        'loomy-new-initialization-receipt',
    ))
    # LobsterAI official context must explicitly allow check_in.
    patches.append((
        'const slot = await fetchLobsteraiActivitySlot(credential, product, clientVersion, fetcher);\n  if (slot === null) return null;',
        'const slot = await fetchLobsteraiActivitySlot(credential, product, clientVersion, fetcher);\n  if (slot === null) return { diagnosticCode: "LOBSTER_SLOT_READ" };\n  if (!slot.slotState || slot.slotState === "available" && !slot.activityCode) return { diagnosticCode: "LOBSTER_SLOT_SHAPE" };',
        'lobster-explicit-slot-status',
    ))
    patches.append((
        'const context = await fetchLobsteraiActivityContext(credential, product, slot, fetcher);\n  if (context === null) return null;',
        'const context = await fetchLobsteraiActivityContext(credential, product, slot, fetcher);\n  if (context === null) return { diagnosticCode: "LOBSTER_CONTEXT_READ" };\n  if (typeof context.claimedToday !== "boolean" || !Array.isArray(context.actions)) return { diagnosticCode: "LOBSTER_CONTEXT_SHAPE" };',
        'lobster-explicit-context-status',
    ))
    patches.append((
        'claimable: context.claimedToday !== true,\n    slotState:',
        'claimable: context.claimedToday === false && context.actions.includes("check_in"),\n    slotState:',
        'lobster-official-action-eligibility',
    ))
    patches.append((
        'claimedToday: readBool2(state, "claimedToday"),\n    actions: readActions(envelope.data, "actions")',
        'claimedToday: typeof state.claimedToday === "boolean" ? state.claimedToday : void 0,\n    actions: Array.isArray(envelope.data.actions) ? readActions(envelope.data, "actions") : void 0',
        'lobster-preserve-unknown-context',
    ))
    start = text.index('async function claimLobsteraiDailyCheckin(')
    end = text.index('async function fetchLobsteraiCreditBalance(', start)
    claim_source = text[start:end]
    claim_patched = claim_source.replace('if (context.claimedToday) {', 'if (typeof context.claimedToday !== "boolean" || !Array.isArray(context.actions)) return { kind: "failed", diagnosticCode: "LOBSTER_CONTEXT_SHAPE" };\n  if (context.claimedToday) {', 1)
    claim_patched = claim_patched.replace('kind: "failed", code: -1, message:', 'kind: "failed", diagnosticCode: "LOBSTER_SLOT_READ", code: -1, message:', 1)
    claim_patched = claim_patched.replace('kind: "failed", code: -1, message:', 'kind: "failed", diagnosticCode: "LOBSTER_CONTEXT_READ", code: -1, message:', 1)
    claim_patched = claim_patched.replace('kind: "failed", code: -1, message:', 'kind: "failed", diagnosticCode: "LOBSTER_CLAIM_REQUEST", code: -1, message:', 1)
    claim_patched = claim_patched.replace('kind: "failed", code: envelope.code, message:', 'kind: "failed", diagnosticCode: "LOBSTER_CLAIM_REJECTED", code: envelope.code, message:', 1)
    patches.append((claim_source, claim_patched, 'lobster-safe-claim-diagnostics'))
    # Only accept actual boolean flags from the shared Buddy status response.
    start = text.index('async function fetchCheckinStatus(')
    end = text.index('async function claimDailyCheckin(', start)
    buddy_status = text[start:end]
    patches.append((buddy_status, buddy_status.replace('const record = data;', 'const record = data;\n  if (typeof record.active !== "boolean" || typeof record.today_checked_in !== "boolean") return null;',1),'buddy-explicit-state-contract'))
    # Preserve safe HTTP/transport categories without logging response bodies.
    start = text.index('async function requestJson2(')
    end = text.index('function describeNonJsonResponse2(',start)
    lobster_request = text[start:end]
    lobster_patched = lobster_request.replace('const text = await response.text();','''if (!response.ok) return { ok:false, diagnosticCode: response.status === 401 ? "LOBSTER_SLOT_AUTH" : response.status === 403 ? "LOBSTER_SLOT_FORBIDDEN" : response.status === 429 ? "LOBSTER_SLOT_LIMIT" : response.status === 404 || response.status === 410 ? "LOBSTER_SLOT_ENDPOINT" : "LOBSTER_SLOT_HTTP", message:"Official activity HTTP failure" };
    const text = await response.text();''',1).replace('ok: false, message: describeNonJsonResponse2(response.status, text)','ok: false, diagnosticCode:"LOBSTER_SLOT_RESPONSE", message:"Invalid official response"',1).replace('ok: false, message: UNPARSABLE_RESPONSE_MESSAGE2','ok: false, diagnosticCode:"LOBSTER_SLOT_RESPONSE", message:UNPARSABLE_RESPONSE_MESSAGE2',1).replace('ok: false, message: error instanceof Error ? error.message : String(error)','ok: false, diagnosticCode:"LOBSTER_SLOT_TRANSPORT", message:"Official activity transport failure"',1)
    patches.append((lobster_request,lobster_patched,'lobster-safe-http-diagnostics'))
    start = text.index('async function fetchLobsteraiActivitySlot(')
    end = text.index('async function fetchLobsteraiActivityContext(',start)
    lobster_slot = text[start:end]
    patches.append((lobster_slot,lobster_slot.replace('if (!result.ok) return null;', 'if (!result.ok) return { diagnosticCode: result.diagnosticCode || "LOBSTER_SLOT_READ" };',1).replace('if (!envelope.ok) return null;','if (!envelope.ok) return { diagnosticCode:"LOBSTER_SLOT_REJECTED" };',1),'lobster-slot-failure-kind'))
    patches.append(('if (slot === null) return { diagnosticCode: "LOBSTER_SLOT_READ" };','if (slot === null) return { diagnosticCode: "LOBSTER_SLOT_READ" };\n  if (slot.diagnosticCode) return { diagnosticCode: slot.diagnosticCode };','lobster-status-preserve-diagnostic'))
    patches.append(('if (slot2.slotState !== "available" || slot2.activityCode.length === 0) {','if (slot2.diagnosticCode) return {kind:"failed",diagnosticCode:slot2.diagnosticCode};\n  if (slot2.slotState !== "available" || slot2.activityCode.length === 0) {','lobster-claim-stop-on-read-failure'))
    # Only the official read-only activity slot's 401 can trigger the existing
    # account renewal service. 403 is a permission denial, not a refresh hint.
    patches.append((
        'async function fetchLobsteraiCheckinStatus(credential, product, clientVersion, fetcher = sanitizingFetch) {',
        '''async function nativeRouterReadLobsterActivityStatus(credential, entry, deps) {
  const first = await deps.read(credential);
  if (first?.diagnosticCode !== "LOBSTER_SLOT_AUTH" || !entry) return first;
  try {
    if (!await deps.stillBound(entry)) return first;
    let current = await deps.resolve(entry);
    if (!current || typeof current.access_token !== "string" || !current.access_token) return first;
    if (current.access_token === credential.access_token) {
      if (!isLobsteraiRefreshable(current) || !await deps.stillBound(entry)) return first;
      if (!await deps.refresh(entry)) return first;
      if (!await deps.stillBound(entry)) return first;
      current = await deps.resolve(entry);
    }
    if (!current || typeof current.access_token !== "string" || !current.access_token || !await deps.stillBound(entry)) return first;
    const result = await deps.read(current);
    return await deps.stillBound(entry) ? result : first;
  } catch {
    return { diagnosticCode: "LOBSTER_SLOT_REFRESH_FAILED" };
  }
}
async function fetchLobsteraiCheckinStatus(credential, product, clientVersion, fetcher = sanitizingFetch) {''',
        'lobster-official-status-renewal',
    ))
    patches.append((
        '  const qoderFamily = [',
        '''  const nativeRouterLobsterRefreshAt = new Map();
  const qoderFamily = [''',
        'lobster-renewal-cooldown',
    ))
    patches.append((
        'fetchStatus: (credential) => fetchLobsteraiCheckinStatus(credential, LOBSTERAI, lobsterClientVersion),',
        '''fetchStatus: (credential, _product, entry) => nativeRouterReadLobsterActivityStatus(credential, entry, {
              read: (current) => fetchLobsteraiCheckinStatus(current, LOBSTERAI, lobsterClientVersion),
              stillBound: async (member) => (await pool.listAccounts(LOBSTERAI.id)).filter(row => row.id === member.id && row.enabled === true && row.credentialRef === member.credentialRef).length === 1,
              resolve: async (member) => {
                const resolved = await ctx.credentials.resolve(credentialRef13(member.credentialRef));
                return resolved ? JSON.parse(resolved.value) : null;
              },
              refresh: async (member) => {
                const now = Date.now();
                const key = JSON.stringify([member.id, member.credentialRef]);
                for (const [binding, at] of nativeRouterLobsterRefreshAt) if (now - at >= 300000) nativeRouterLobsterRefreshAt.delete(binding);
                if (nativeRouterLobsterRefreshAt.has(key) || nativeRouterLobsterRefreshAt.size >= 256) return false;
                nativeRouterLobsterRefreshAt.set(key, now);
                await lobsterai.refreshAccountCredential(member.credentialRef, pool, member.id);
                return true;
              }
            }),''',
        'lobster-wire-official-read-renewal',
    ))
    names = []
    for old, new, name in patches:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"Patch {name}: expected exactly one pinned anchor, got {count}")
        text = text.replace(old, new, 1)
        names.append(name)
    # Auth Service constructors in the MIT pack ordinarily publish names such as
    # codeartsAuth, workbuddyAuth and loomyAuth into the Host Cordis registry.
    # The original plugins keep those names. Give every privately-owned auth
    # service a unique name before the first constructor runs, not only the
    # account pool and model provider aliases. No original Host service changes.
    original_auth = 'super(ctx, options.serviceName ?? `${product.id}Auth`);'
    owned_auth = 'super(ctx, options.serviceName ?? `nativeRouterSource${product.id}Auth`);'
    if text.count(original_auth) != 10:
        raise SystemExit("Pinned Auth Service default names changed; refuse collision-prone build")
    text = text.replace(original_auth, owned_auth)
    codearts_auth = 'super(ctx, "codeartsAuth");'
    if text.count(codearts_auth) != 1:
        raise SystemExit("Pinned CodeArts Auth Service name changed")
    text = text.replace(codearts_auth, 'super(ctx, "nativeRouterSourceCodeartsAuth");', 1)
    names.append("namespace-all-private-auth-services")
    # Always register a namespaced DSH model adapter for the plugin-owned
    # account pool. The original registered host Provider is never replaced.
    # Source login and inference must remain possible even if an original
    # WorkBuddy/Loomy/etc plugin already has the same public provider ID.
    begin = text.index('function registerAdapterIdempotent(llm, providers, adapter, warn) {')
    end = text.index('\n// vendor/channel-pack/src/llm-adapter.ts', begin)
    target = text[begin:end]
    if target.count('wrapAdapterWithTokenLedger(providers, adapter)') != 1:
        raise SystemExit("Cannot derive independent source provider alias safely")
    # Deliberately preserve upstream auth and RPC even when one independent
    # model adapter is unsupported in the user's actual DSH desktop runtime.
    # Crucial: original host Provider names are NEVER registered by this pack.
    # Every adapter is optional and its registration is separately owned.
    replacement = """var nativeSourceAliasDisposers = new WeakMap();
 var nativeSourceAdapterStates = new WeakMap();
var nativeSourceModelEligibility = new WeakMap();
function rollbackNativeRouterSourceAdapters(ctx) {
  const members = nativeSourceAliasDisposers.get(ctx) ?? [];
  for (const release of [...members].reverse()) {
    try { release(); } catch {}
  }
  nativeSourceAliasDisposers.delete(ctx);
  nativeSourceAdapterStates.delete(ctx);
}
function registerAdapterIdempotent(ctx, providers, adapter, warn) {
  const llm = ctx?.llm;
  const prefix = "native-router-source-";
  const aliases = providers.map(id => prefix + id);
  const report = state => {
    const snapshot = nativeSourceAdapterStates.get(ctx);
    if (snapshot) for (const id of providers) snapshot[id] = state;
  };
  // An unknown host runtime API is NOT a reason to disable independent
  // account login. Host-owned adapters are never replaced or deregistered.
  let registered;
  try { registered = llm?.listProviders?.(); } catch {}
  if (!Array.isArray(registered) || typeof llm?.registerAdapter !== "function") {
    report("llm_unavailable"); return;
  }
  const existing = new Set(registered.map(row =>
    typeof row === "string" ? row : row?.id ?? row?.provider));
  if (aliases.some(id => existing.has(id))) {
    report("alias_occupied"); return;
  }
  let target;
  try {
    target = wrapAdapterWithTokenLedger(providers, adapter);
    if (typeof adapter === "object" && adapter !== null) {
      try { target = withDeadModelPruning(providers, target); }
      catch { warn?.("[native-router] Source model pruning unavailable"); }
    }
  } catch {
    report("adapter_incompatible"); return;
  }
  const actual = id => {
    if (typeof id !== "string" || !id.startsWith(prefix))
      throw new Error("Invalid independent source model provider");
    const provider = id.slice(prefix.length);
    if (!providers.includes(provider)) throw new Error("Unowned source provider");
    return provider;
  };
  const allow = source => {
    const proof = nativeSourceModelEligibility.get(ctx);
    try { return typeof proof === "function" && proof(source) === true; }
    catch { return false; }
  };
  const aliasAdapter = {
    providerInfo(id) {
      const value = target.providerInfo(actual(id));
      // The owning alias is its own DSH Provider; the source provider remains unchanged.
      return {...value, id, name: value.name};
    },
    providerRetryPolicy(id) { return target.providerRetryPolicy(actual(id)); },
    async listModels(id, ...rest) {
      const source = actual(id);
       if (!allow(source)) return [];
       const rows = await target.listModels(source, ...rest);
      if (!Array.isArray(rows)) return [];
      // Host model catalog validates row.provider against the registered alias.
      // A raw source row uses "loomy"/"zcode"/etc and is rejected as invalid.
      // Filter duplicate/foreign/invalid rows without changing the original adapter.
      const ids = new Set(),models = [];
      for (const item of rows) {
        const model = typeof item === "string" ? {id:item,name:item} : item;
        if (!model || typeof model !== "object" || Array.isArray(model)
          || typeof model.id !== "string" || !model.id.trim() || model.id.length > 160
          || /[\\u0000-\\u001f]/.test(model.id)
          || (model.provider && model.provider !== source && model.provider !== id)
          || ids.has(model.id)) continue;
        ids.add(model.id);
        models.push({...model,provider:id,
          name:typeof model.name === "string" && model.name.trim() ? model.name : model.id});
        if (models.length >= 256) break;
      }
      return models;
    },
    async resolveModel(provider, model, signal) {
      const source = actual(provider);
      if (!allow(source)) throw new Error("Independent source account not verified");
      if (typeof model !== "string" || !model.trim() || model.length > 160)
        throw new Error("Invalid independent source model");
      let resolved;
      if (typeof target.resolveModel === "function") {
        resolved = await target.resolveModel(source, model, signal);
      } else {
        const listed = await this.listModels(provider);
        resolved = listed.find(row => row.id === model);
      }
      if (!resolved || resolved.id !== model ||
        (resolved.provider && resolved.provider !== source && resolved.provider !== provider))
        throw new Error("Independent source model metadata unavailable");
      return {...resolved, provider};
    },
    async prepareCall(provider, model, signal) {
      const source = actual(provider);
      const resolved = await this.resolveModel(provider, model, signal);
      if (typeof target.prepareCall === "function") {
        const prepared = await target.prepareCall(source, model, signal);
        if (!prepared || typeof prepared.stream !== "function" ||
          prepared.model?.id !== model)
          throw new Error("Independent source call preparation failed");
        return {...prepared, model:{...prepared.model, ...resolved,provider},
          stream:options=>prepared.stream({...options,provider:source})};
      }
      return {model:resolved,
        stream:options=>target.stream({...options,provider:source})};
    },
     stream(options) { const source=actual(options.provider);
       if (!allow(source)) throw new Error('Independent source account not verified');
       return target.stream({...options, provider: source}); }
  };
  let cleanup;
  try {
    cleanup = llm.registerAdapter(aliases, aliasAdapter);
    if (typeof cleanup !== "function") throw new Error("DSH adapter dispose contract unavailable");
    const members = nativeSourceAliasDisposers.get(ctx) ?? [];
    nativeSourceAliasDisposers.set(ctx, members);
    let released = false;
    const once = () => {
      if (released) return;
      released = true;
      const index = members.indexOf(once);
      if (index >= 0) members.splice(index, 1);
      const snapshot = nativeSourceAdapterStates.get(ctx);
      if (snapshot) for (const id of providers) snapshot[id] = "disposed";
      cleanup();
    };
    members.push(once);
    // registerAdapter returns a release bound to our Cordis child scope.
    // Never release a Provider registered by another plugin.
    try { ctx.effect(() => once); }
    catch (error) { once(); throw error; }
    report("ready");
    return once;
  } catch {
    try { cleanup?.(); } catch {}
    report("adapter_registration_failed");
    return;
  }
}
"""
    if text.count("registerAdapterIdempotent(ctx.llm,") != 12:
        raise SystemExit("Pinned source adapter call count drift")
    text=text.replace("registerAdapterIdempotent(ctx.llm,",
                      "registerAdapterIdempotent(ctx,",12)
    text=text[:begin]+replacement+text[end:]
    names.extend([
        "scope-llm-adapter-cleanup",
        "register-independent-source-provider-aliases",
        "failed-source-alias-transactional-rollback",
        "auth-first-independent-model-adapter-fail-open",
        "never-register-original-host-provider",
        "source-adapter-readiness-metadata",
    ])
    # Hook only known, exactly once pinned source anchors. No credential contents.
    for old, new, patch_name in [
        (
          '  const pool = new AccountPool(ctx);\n',
          '  config.nativeRouterPhase?.("account_pool");\n'
          '  const pool = new AccountPool(ctx);\n'
          '  nativeSourceAdapterStates.set(ctx, Object.create(null));\n'
          '  ctx.effect(() => () => nativeSourceAdapterStates.delete(ctx));\n',
          'per-scope-source-model-readiness',
        ),
        (
          '  const codearts = registerCodeArtsLlm(ctx, {',
          '  config.nativeRouterPhase?.("model_adapters");\n'
          '  const codearts = registerCodeArtsLlm(ctx, {',
          'explain-source-model-start',
        ),
        (
          '  registerChannelPackRpc(ctx, pool, service, buddy, workbuddy, lobsterai, qoder, qoderCn, trae, cline, loomy, raccoon, minimax, zcode, gemini, modelAdapters, {',
          '  config.nativeRouterPhase?.("rpc_routes");\n'
          '  registerChannelPackRpc(ctx, pool, service, buddy, workbuddy, lobsterai, qoder, qoderCn, trae, cline, loomy, raccoon, minimax, zcode, gemini, modelAdapters, {',
          'explain-source-rpc-register',
        ),
        (
          '  config.nativeRouterPoolReady?.(pool);\n',
          '  config.nativeRouterPoolReady?.(pool);\n'
          '  config.nativeRouterModelReady?.(nativeSourceAdapterStates.get(ctx) ?? {});\n'
          '  config.nativeRouterPhase?.("complete");\n',
          'source-model-diagnostics-to-owner-only',
        ),
    ]:
        if text.count(old)!=1:
            raise SystemExit("Pinned source lifecycle anchor drift: "+patch_name)
        text=text.replace(old,new,1)
        names.append(patch_name)
    # A mounted account pool is not proof that the authenticated login API
    # was attached. Observe actual Connection fetch registration explicitly.
    old_rpc_ready = '  async function enrichAccountIdentity(accounts, provider) {'
    new_rpc_ready = (
        '  config.nativeRouterRpcReady?.(true);\n'
        '  ctx.effect(() => () => config.nativeRouterRpcReady?.(false));\n'
        '  async function enrichAccountIdentity(accounts, provider) {'
    )
    if text.count(old_rpc_ready)!=1:
        raise SystemExit('Pinned Connection RPC readiness anchor drift')
    text=text.replace(old_rpc_ready,new_rpc_ready,1)
    names.append('source-rpc-registered-readiness-callback')
    old_export='  apply,\n  channelProxyBypassed,'
    new_export='  apply,\n  rollbackNativeRouterSourceAdapters,\n  channelProxyBypassed,'
    if text.count(old_export)!=1:
        raise SystemExit("Pinned source export anchor drifted")
    text=text.replace(old_export,new_export,1)
    # Limit source credits.status/claimAll to the exact selected source account
    # (the original UI batch RPC still works when no accountId is provided).
    start = text.index('      case "credits.status": {')
    end = text.index('      case "credits.balances": {', start)
    region = text[start:end]
    old = 'await pool.listAccounts(req.provider)'
    count = region.count(old)
    if count < 8:
        raise SystemExit(f"Source credits scope changed upstream: expected many per-provider pool reads, got {count}")
    text = text[:start] + region.replace(old, 'await nativeRouterCreditAccounts(req)') + text[end:]
    names.append("scope-all-credits-status-and-claims-to-one-account")
    # Upstream Gemini embeds a Google OAuth client ID/secret. They are not
    # plugin-owned credentials and must NEVER be distributed or pushed to a
    # public repository. Preserve upstream snapshot unchanged; the derived
    # source requires explicit local OAuth credentials through the already
    # supported CMDC_PAK_GOOGLE_CLIENT_ID/SECRET environment variables.
    for suffix in ("ID", "SECRET"):
        name = "GEMINI_DEFAULT_CLIENT_" + suffix
        pattern = re.compile(r'(?m)^var ' + name + r' = (.+);$')
        matches = list(pattern.finditer(text))
        if len(matches) != 1 or len(matches[0].group(1)) < 10:
            raise SystemExit("Pinned upstream Google OAuth default cannot be safely redacted: " + suffix)
        text = text[:matches[0].start()] + 'var ' + name + ' = "";' + text[matches[0].end():]
        names.append("remove-upstream-google-oauth-default-" + suffix.lower())
    for key in ("GEMINI_DEFAULT_CLIENT_ID", "GEMINI_DEFAULT_CLIENT_SECRET"):
        if not re.search(r'(?m)^var ' + key + r' = "";$', text):
            raise SystemExit("Google OAuth default redaction did not hold")
    generated = text.encode("utf8")
    metadata = {
        "kind": "deterministic-in-process-derivative",
        "upstreamSourceCommit": source_manifest["sourceCommit"],
        "originalFile": "pack.js",
        "originalSha256": expected,
        "generatedFile": "pack-native.js",
        "generatedBytes": len(generated),
        "generatedSha256": sha(generated),
        "patches": names,
        "additionalRuntimeProcessRequired": False,
        "bundledByDSHPlugin": True,
    }
    receipt = (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode("utf8")
    if check:
        if not BUILT.exists() or BUILT.read_bytes() != generated:
            raise SystemExit("Generated native channel bundle is stale: run builder before release")
        if not RECEIPT.exists() or RECEIPT.read_bytes() != receipt:
            raise SystemExit("Native build receipt mismatch")
    else:
        BUILT.write_bytes(generated)
        RECEIPT.write_bytes(receipt)
    print(json.dumps({
        "result": "PASS", "check": check,
        "originalSha256": expected, "generatedSha256": metadata["generatedSha256"],
        "generatedBytes": len(generated), "patchCount": len(names),
    }))

if __name__ == "__main__":
    import sys
    build(check="--check" in sys.argv[1:])
