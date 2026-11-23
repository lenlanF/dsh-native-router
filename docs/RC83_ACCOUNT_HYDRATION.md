# RC83: owned member metadata and reward safety

Production DSH remains rc81 (8 providers, 10 accounts), user declined upgrade. No changes to production files, credentials or account pools.

Root cause: own MiMo, Doubao, Meoo and QwenWork drivers lacked refreshAccountStatus. AccountCenter skipped their read-only fetch when persisted online proof was fresh even while volatile nickname/quota snapshots were empty.

Fix: the four drivers expose authentic read-only membership status; AccountCenter hydrates missing volatile snapshots exactly once per host lifecycle with account-specific binding and bounded retries.

WorkBuddy: original installed v5.24.14 vault holds UID/UIN/nickname. Explicitly adopted historical accounts recover only the public nickname on exact identity/region hash match; save independently so deleting original plugin does not erase it. Model and billing requests use real UID, not unrelated UIN.

WorkBuddy benefits do not count as daily sign-in. Only official daily check-in confirmation counts as a successful daily claim. An ambiguous POST stops repeat automatic and manual daily claims, persisted via checkin history; independently verified gift count retained separately.

MiMo subscription and 7-day naturally replenished quota are independent concurrent official reads. A slow subscription cannot starve free quota; neither uses paid API.

Doubao source identity UID is verified against its independently stored account, member entitlement and daily promotion reads operate regardless of model catalog outages. No model generation or claim is triggered during read-only restoration.

Meoo and QwenWork restore member balance and identity from owned sessions; Qwen remains tenant-identity scoped.

Regression: 697/697 local tests passed before version bump, including two Host lifetimes across five owned providers, no duplicate credit claims, slow subscription, lost model catalog, original WorkBuddy uninstall, UID versus UIN.

Release still requires audited tarball, vendor reproducibility, privacy audit, Cordis smoke and official CI on main.

Live-account balances are NOT confirmed in user production because upgrade is intentionally deferred. Synthetic tests never represent actual user money or credits.