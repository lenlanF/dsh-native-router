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
            '  ctx.provide("nativeRouterSourceAccountPool", pool);',
            'private-account-pool-service',
        ),
        (
            'this.ctx.get("accountPool");',
            'this.ctx.get("nativeRouterSourceAccountPool");',
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
    names = []
    for old, new, name in patches:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"Patch {name}: expected exactly one pinned anchor, got {count}")
        text = text.replace(old, new, 1)
        names.append(name)
    # Always register a namespaced DSH model adapter for the plugin-owned
    # account pool. The original registered host Provider is never replaced.
    # Source login and inference must remain possible even if an original
    # WorkBuddy/Loomy/etc plugin already has the same public provider ID.
    begin = text.index('function registerAdapterIdempotent(llm, providers, adapter, warn) {')
    end = text.index('\n// vendor/channel-pack/src/llm-adapter.ts', begin)
    target = text[begin:end]
    if target.count('wrapAdapterWithTokenLedger(providers, adapter)') != 1:
        raise SystemExit("Cannot derive independent source provider alias safely")
    replacement = """function registerAdapterIdempotent(llm, providers, adapter, warn) {
  const registered = llm?.listProviders?.();
  if (!Array.isArray(registered)) throw new Error("Host provider inventory unavailable");
  const existing = new Set(registered.map((row) => typeof row === "string" ? row : row?.id ?? row?.provider));
  const originalProviders = providers.filter((id) => !existing.has(id));
  let target = wrapAdapterWithTokenLedger(providers, adapter);
  if (typeof adapter === "object" && adapter !== null) {
    try {
      target = withDeadModelPruning(providers, target);
    } catch {
      warn?.("[native-router] Model-pruning extension unavailable; using the original verified adapter");
    }
  }
  // Only this alias represents the plugin-owned source pool. Host routes keep
  // their existing names, account stores and credentials completely intact.
  const prefix = "native-router-source-";
  const aliases = providers.map((id) => prefix + id);
  if (aliases.some((id) => existing.has(id))) {
    throw new Error("Native Router internal adapter alias already occupied");
  }
  const actual = (id) => {
    if (typeof id !== "string" || !id.startsWith(prefix)) {
      throw new Error("Invalid independent source model provider");
    }
    const provider = id.slice(prefix.length);
    if (!providers.includes(provider)) throw new Error("Unowned source provider");
    return provider;
  };
  const aliasAdapter = {
    providerInfo(id) {
      const value = target.providerInfo(actual(id));
      return { ...value, id, name: value.name + " · 聚合路由自有" };
    },
    providerRetryPolicy(id) { return target.providerRetryPolicy(actual(id)); },
    listModels(id, ...rest) { return target.listModels(actual(id), ...rest); },
    stream(options) { return target.stream({ ...options, provider: actual(options.provider) }); }
  };
  const releaseAlias = llm.registerAdapter(aliases, aliasAdapter);
  if (originalProviders.length === 0) return releaseAlias;
  try {
    const releaseOriginal = llm.registerAdapter(originalProviders, target);
    return () => { releaseOriginal?.(); releaseAlias?.(); };
  } catch (error) {
    if (!isDuplicateRegistrationError(error)) {
      releaseAlias?.();
      throw error;
    }
    // Another host plugin won the original-name registration race. Keep the
    // independent alias; never borrow its route for our source-pool account.
    warn?.("[native-router] Original provider already owned by host; independent channel remains available");
    return releaseAlias;
  }
}
"""
    # Upstream callers discard registerAdapterIdempotent's returned
    # disposables. Bind releases to the actual Cordis scope explicitly, or
    # HMR/plugin reload leaks native-router-source-* adapters and the next
    # mount fails in register_owned_adapter. No other plugin is unregistered.
    if text.count("registerAdapterIdempotent(ctx.llm,") != 12:
        raise SystemExit("Expected 12 pinned original source adapter call sites")
    replacement = replacement.replace(
        "function registerAdapterIdempotent(llm, providers, adapter, warn) {",
        "function registerAdapterIdempotent(ctx, providers, adapter, warn) {\n  const llm = ctx?.llm;")
    replacement = replacement.replace(
        "  if (originalProviders.length === 0) return releaseAlias;",
        "  const retain = (cleanup) => {\n"
        "    try { ctx.effect(() => cleanup); }\n"
        "    catch (error) { cleanup?.(); throw error; }\n"
        "    return cleanup;\n"
        "  };\n"
        "  if (originalProviders.length === 0) return retain(releaseAlias);")
    replacement = replacement.replace(
        "    return () => { releaseOriginal?.(); releaseAlias?.(); };",
        "    return retain(() => { releaseOriginal?.(); releaseAlias?.(); });")
    replacement = replacement.replace(
        "    return releaseAlias;\n  }\n}",
        "    return retain(releaseAlias);\n  }\n}")
    text = text.replace("registerAdapterIdempotent(ctx.llm,",
        "registerAdapterIdempotent(ctx,", 12)
    names.append("scope-llm-adapter-cleanup")
    text = text[:begin] + replacement + text[end:]
    names.append("register-independent-source-provider-aliases")
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
