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

The v3.5.4 native derivative retains the same **13 built-in channel-pack sources**, 51 independent safety transformations, and a single in-process Cordis runtime. This refresh incorporates upstream CodeArts/Qoder model and activity compatibility changes only; top-level upstream Meoo Web, QwenWork, and Doubao browser-session modules are **not** part of `vendor/channel-pack/pack.js` and have **not** been silently installed or claimed as supported online accounts. Local source transformation, standalone runtime build, and owned-account RPC tests must pass before merging. The user's running DSH installation remains unchanged until independent online acceptance.


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

## Security expectations

Do not upload any original DSH Profile files, local desktop authentication
cache, account databases, browser cookies, live login screenshots or debug logs
to this repository. The `tests/` directory must contain synthetic examples only;
CI examines tracked content for common credential and private-path signatures.
Automated pattern scanning is not a substitute for manual review.
