"""Rebuild the self-contained DSH-native channel pack derivative.

This developer-only build tool is NOT needed when installing/running the
DSH plugin. Never change or overwrite the pinned MIT upstream snapshot.
"""
from __future__ import annotations
import hashlib
import json
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
