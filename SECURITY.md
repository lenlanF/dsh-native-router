# Security Policy

## Supported versions

The current candidate source is `1.0.0-rc.12`; production compatibility and real-account authentication remain uncertified. Historical Git commits may still contain files subsequently removed from Git tracking; history rewriting, force push and production releases require separate authorization.

## Report a vulnerability privately

Do **not** include credentials, tokens, cookies, auth database contents, user paths, personal data or private logs in a public issue or pull request.

Use GitHub's private vulnerability reporting / Security Advisories for this repository if available. If it is not enabled, contact the repository maintainer through their GitHub profile and agree on a **private** channel before sharing sensitive reproduction details. Never post a secret to a public GitHub issue.

## Security boundaries

- The plugin is a single DSH Cordis plugin; it must not start an independent gateway or leak credentials into the router configuration.
- Delegation mode borrows original providers without copying their credentials. With explicit per-account consent, independent adoption copies compatible AccountPool credentials only within DSH Credentials, under a fresh native-router-owned reference; original records remain untouched. Neither mode exports secrets into this repository, config JSON, admin API replies or debug logs.
- Desktop WorkBuddy auth discovery is read-only and opt-in. Do not run secret-bearing tests against a real client profile.
- Private plugin sessions are not presumed portable. An owned credential copy does not prove valid online authentication: verify models, refresh and check-in before retiring the original plugin. Abort adoption if owner consent or persistent private storage is absent.
- Host routing and daily check-in are opt-in. Any real OAuth or account-dependent testing requires the account owner's explicit permission.
- Admin routes must remain behind authenticated DSH Connection and enforce origin restrictions.
- **No guarantee of exactly-once irreversible tool side effects across process crash or power loss.** Retain host failover disabled for such operations until separately validated.
- Automated secret-pattern checks, immutable source receipts and SHA checks are defense-in-depth, not proof that unseen credentials cannot be leaked.

## AutoFree model billing evidence

Only upstream explicit free metadata, or both zero input and zero output pricing, can make a model eligible for AutoFree. Missing prices, a name containing Free and Provider registration cannot establish zero billing or successful remote login. No host login token is copied simply to populate the pool.

## Upstream OAuth defaults are not published

The pinned MIT source snapshot is preserved only as a source-verification reference. The distributed native derivative and standalone runtime deliberately remove Google's embedded OAuth client ID and secret, which triggered GitHub push protection. For the optional Gemini independent login, an operator must explicitly configure the upstream-supported private environment values `CMDC_PAK_GOOGLE_CLIENT_ID` and `CMDC_PAK_GOOGLE_CLIENT_SECRET`. Never commit those values to Git, a config file or an issue. This is not a user-account token migration and does not affect the other built-in channels.

## If a credential was exposed

Revoke or rotate it at the issuing service first; removing a file from GitHub does not invalidate a credential or necessarily remove cached copies. Coordinate any history cleanup privately, avoid copying secret values into reports, and then publish a sanitized fix.
