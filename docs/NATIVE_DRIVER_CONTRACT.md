# Native channel driver integration contract

Register a real provider driver from the package export dsh-native-router/drivers via registerNativeChannelDriver(providerId, driver), and call the returned disposer when stopping.
Registration is declarative: it MUST NOT scan private files, start a login, import credentials, or execute a check-in.

Methods (all optional; interfaces are injected explicitly, never guessed):
- generate({provider,account,model,options,signal}) -> a fully completed response {text,reasoning,toolCalls,finishReason,usage}. Tools must be a subset of options.tools, and only DSH executes them.
- listModels({provider,account,signal}) -> an array of model IDs or {id} entries.
- login({provider,account,resolveCredential}) -> {state,message}. Real OAuth/QR login only when the driver implements it.
- refresh({provider,account,resolveCredential}) -> {state,message}; must not claim login if only a shallow credential check occurred.
- logout({provider,account}) -> revoke the channel session when supported; the account center then removes its own reference.
- discover({provider}) -> [{id,label,source}]. No raw cookies, tokens or private filesystem paths may be exposed.
- importCandidate({provider,candidateId,consent:true}) -> {id,credentialRef:'driver:provider-id:opaque-id'}. The account is created disabled and never auto-checks in.
- checkIn({provider,account,date,source}) -> confirmed:true plus matching date only after authoritative server verification. Pending, no-task and client-required stay separate.

Native providers use protocol native-channel; baseUrl is not used. Their account credentialRef uses a validated driver:<provider>:<account> reference. Missing drivers cause catalog models to be hidden rather than advertised as ready.

Security and acceptance: use authorized official login flows, keep credential storage protected, never bypass DSH Host permissions. Test real login/expiry/refresh/logout, duplicate import, confirmation checks, SSE disconnection, current-turn tool changes and cancellation before shipping proprietary adapters.

Status: Alpha.3 has an implemented WorkBuddy native-channel driver using the official desktop app's read-only authorization files and a fixed known WorkBuddy upstream transport. It never stores copied tokens in plugin configuration and local unbind is NOT upstream session revocation. Real-host compatibility and daily sign-in have NOT been verified. See WORKBUDDY_NATIVE.md.

Compatibility: OpenAI Chat and Anthropic Messages still work as generic providers. The two new settings sections do not modify existing DSH account directories, models, old failover plugin or operating system schedules.

## Alpha.4 phase

The CodeArts native-channel adapter supports discovered user-provisioned environment profiles, explicit reviewed import, HMAC-signed requests and authentic directory probing. It has NO new-login OAuth UI yet and never persists AK/SK or DPoP private key in generic router JSON. OpenAI and native catalog discovery unions enabled-account models, capped at 32 account probes and 256 model names per provider. See CODEARTS_NATIVE.md.
