> 历史版本记录（非当前支持范围）：rc.116 起退役渠道及其专属实现、测试均已独立归档；下列历史验收内容不得作为当前版本的接入或执行说明。

# Pinned channel pack: what is actually shipped

This project retains the upstream MIT attribution and unmodified audit snapshot in
`vendor/channel-pack/`, including the original historical `NOTICE.md`. That
historical NOTICE describes the **upstream project's old topology**; it is not
an instruction to run its old scripts, gateway, or OFM UI.

## Provenance

- Original source project: [hulibuld/dsh-get-it-for-free](https://github.com/hulibuld/dsh-get-it-for-free), tag `v3.5.4`, immutable commit `114b4a516ab32e6f318a53cab4ac7f83ef8dd0b0` (2026-11-20). Previous pinned snapshot `v3.2.0` / `6daa5bc344feac44763af25c674e8882c292a728` remains in repository Git history for audit.
- Underlying upstream: [iJetLi/deepseek-harness-codearts](https://gitee.com/iJetLi/deepseek-harness-codearts), commit `345f0a07b22713c0ae189ca7d8b97ec4f64626c6`.
- `vendor/channel-pack/pack.js` is the original, frozen MIT snapshot for audit. **It is NOT loaded at runtime or shipped as an npm package file.**
- `vendor/channel-pack/pack-native.js` is the deterministic in-process derivative, the **only** runtime channel-pack JS. It disables its own OpenAI gateway, redundant loop resume, automatic sign-in scheduler and refresh daemon. Only user-enabled DSH configuration may mount the source pack.
- `vendor/channel-pack/qoder-auth-wasm.wasm` is the unchanged Qoder binary component. It is never newline-normalized.
- MIT license text is included in `LICENSE`, `LICENSES/` and `vendor/channel-pack/LICENSE`. Attribution remains in `vendor/channel-pack/NOTICE.md`. Original source is provided for audit under its MIT terms.

The v3.5.4 native derivative retains the same **13 built-in channel-pack sources**, **53 independently verified safety transformations**, and a single in-process Cordis runtime. The two additional changes specifically bind Loomy's official SMS send/submit RPCs to an enabled Loomy-owned account, preventing cross-provider credential overwrite. This refresh incorporates upstream CodeArts/Qoder model and activity compatibility changes only; top-level upstream Meoo Web, QwenWork, and Doubao browser-session modules are **not** part of `vendor/channel-pack/pack.js` and have **not** been silently installed or claimed as supported online accounts. Production DSH is not updated by compiling this derivative.


## Cross-platform reproducible build

`SOURCE_RECEIPT.json` pins **Git canonical LF** byte count and SHA-256 for
textual source files and **raw bytes** for the WASM file. No receipt
includes user credentials, cookies, tokens, auth files or local account state.

```shell
python tools/build-native-channel-pack.py --check
node --test tests/native-pack-bundle.test.mjs
```

To regenerate the derivative after explicitly reviewing the source transformation:

```shell
python tools/build-native-channel-pack.py
python tools/build-native-channel-pack.py --check
```

Changes to the frozen MIT upstream require a separate provenance review. Do
not silently rewrite `pack.js`, `qoder-auth-wasm.wasm` or its copyright text.
The release bundle is one DSH Cordis plugin and must not launch a second
localhost listener.

## v3.5.4 candidate verification (2026-11-22, Windows bound workstation)

The source refresh was built and inspected in an isolated E:\\Temp dependency directory
using pinned esbuild 0.25.12 and the actual DSH-managed Node.js v22.16.0.
No production DSH plugin, account, sign-in setting, or original Host Provider was changed.

- Immutable original (LF) SHA-256: `5b933808951453cab76227e68cea480c6321e746e152f9e78963d5562faceb27`.
- 53-transformation native source SHA-256: `6005d65ba6c9453f39971c6f32332087fe24c2a9290683ad9ba7518a8c662638`.
- Independently bundled standalone runtime SHA-256: `fe23c03f7de1096e5e09deab5e92e3b0066b3b0cc262f19486bd6f88b64c8efe`.
- Windows full `npm test` must pass, canonical source and standalone receipt `--check` PASS,
  public tracked-source privacy scan PASS.
- Real in-process Cordis sandbox with zero authenticated accounts: **13/13** registered
  private aliases, **13/13** independent account-list RPCs completed without exposing
  Host accountPool; each unauthorized alias advertises **zero** models and refuses
  model resolution. Normal and multi-account modes both passed, credential reads/writes
  **0**, scoped account pool released on disposal.
- Physically created and extracted a candidate npm `.tgz` with **94/94** file hashes
  checked, no private state or developer helpers, imports using the actual DSH Node without
  nested `node_modules`. This is a **candidate**, not a published/installed release.
- **Not yet accepted**: account-specific live entitlement, independent renewal after original
  plugin removal, real DSH Host model `finish(stop)` after v3.5.4 deployment, Agent-level
  failure continuation, and the Meoo Web/QwenWork extensions outside this source bundle.
  The reference upstream Doubao Chromium-cookie reader returns `null` on Windows; it is
  **not** a working Windows session takeover path.

## Security expectations

Do not upload any original DSH Profile files, local desktop authentication
cache, account databases, browser cookies, live login screenshots or debug logs
to this repository. The `tests/` directory must contain synthetic examples only;
CI examines tracked content for common credential and private-path signatures.
Automated pattern scanning is not a substitute for manual review.
