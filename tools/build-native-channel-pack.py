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
    # The Host normalizes model lists and can remove exact CodeArts
    # credit rates. Scoped direct adapter catalog preserves official metadata.
    patches.append((
        '  });\n  const resolveBuddyCredentialByRef = async (refName) => {',
        '  });\n  config.nativeRouterSourceCatalogReady?.({\n'
        '    codearts: () => codearts.listModels("codearts"),\n'
        '    codeartsOneShot: request => codearts.stream({...request, nativeRouterOneShot: true})\n'
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
