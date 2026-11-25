// Pure decision helpers: no Cordis or runtime imports, so tests can run in plain Node.

// The chain is the user's to define. An empty default means "no failover until
// a chain is configured" rather than silently substituting models this plugin
// guessed at: a guessed model can be missing or metered, and either one turns a
// quota event into a failed switch.
export const DEFAULT_PRIORITY = Object.freeze([]);

export const DEFAULT_TRIGGERS = Object.freeze([
  'QUOTA', 'ACCOUNT_QUOTA', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT',
  'STREAM_CLOSED', 'PROVIDER_NOT_READY',
]);

const BUILTIN_QUALIFYING = new Set(DEFAULT_TRIGGERS);
const CUSTOM_CODE = /^HTTP_(?:[1-5][0-9][0-9])$/;
const DENY_CODES = new Set([
  'INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED', 'EMPTY_RESPONSE',
  'MALFORMED_RESPONSE', 'IMAGE_OFFLOAD_REQUIRED', 'ABORTED', 'CANCELLED',
]);
const QUOTA_WORDING = /(?:\binsufficient[_ -]?(?:quota|balance|credits?)\b|\b(?:quota|usage[_ -]+limit)[_ -]*(?:exceeded|exhausted|reached|depleted)\b|\b(?:balance|credits?)[_ -]*(?:exhausted|depleted)\b|\bout of (?:credits?|budget)\b)/i;
// DSH can surface a broken upstream HTTP stream as UNKNOWN / terminated.
const TRANSPORT_WORDING = /\b(?:terminated|fetch failed|network error|socket hang up|UND_ERR_SOCKET|ECONNRESET|connection reset|socket closed)\b|网络中断|连接重置/i;

/** Normalize a user rule entry into a complete selection. */
export function normalizeSelection(entry) {
  if (typeof entry === 'string') {
    const slash = entry.indexOf('/');
    if (slash <= 0 || slash === entry.length - 1) return undefined;
    const selection = { provider: entry.slice(0, slash).trim(), model: entry.slice(slash + 1).trim() };
    return selection.provider && selection.model ? selection : undefined;
  }
  if (entry === null || typeof entry !== 'object') return undefined;
  const provider = typeof entry.provider === 'string' ? entry.provider.trim() : '';
  const model = typeof entry.model === 'string' ? entry.model.trim() : '';
  if (!provider || !model) return undefined;
  const selection = { provider, model };
  const effort = entry.reasoningEffort ?? entry.reasoning_effort;
  if (typeof effort === 'string' && effort.trim()) selection.reasoningEffort = effort.trim();
  // A free tier is a user assertion: the model catalog exposes no billing
  // metadata, so only an explicit mark can make a tier free.
  if (entry.free === true) selection.free = true;
  return selection;
}

/** Normalize config into a validated, detached rule set; invalid entries are dropped. */
export function normalizeRules(config = {}) {
  const raw = Array.isArray(config.priority) ? config.priority : DEFAULT_PRIORITY;
  const seen = new Set();
  const priority = [];
  for (const entry of raw) {
    const selection = normalizeSelection(entry);
    if (!selection) continue;
    const key = `${selection.provider}/${selection.model}/${selection.reasoningEffort ?? ''}/${selection.free === true ? 'free' : 'paid'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    priority.push(Object.freeze(selection));
  }
  const triggers = Array.isArray(config.triggers) && config.triggers.length > 0
    ? config.triggers.filter((code) => typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code)).map((code) => code.trim())
    : [...DEFAULT_TRIGGERS];
  const maxSwitches = Number.isFinite(config.maxSwitchesPerSession) && config.maxSwitchesPerSession >= 0
    ? Math.floor(config.maxSwitchesPerSession) : 3;
  const cooldownMs = Number.isFinite(config.cooldownMs) && config.cooldownMs >= 0 ? config.cooldownMs : 0;
  return Object.freeze({
    priority: Object.freeze(priority),
    triggers: Object.freeze([...new Set(triggers)]),
    enabled: config.enabled !== false,
    maxSwitchesPerSession: maxSwitches,
    cooldownMs,
    exhaustionCooldownMs: Number.isFinite(config.exhaustionCooldownMs) && config.exhaustionCooldownMs >= 0
      ? config.exhaustionCooldownMs : DEFAULT_COOLDOWN_MS,
    switchLogLimit: Number.isFinite(config.switchLogLimit) && config.switchLogLimit >= 1
      ? Math.floor(config.switchLogLimit) : 20,
    switchLog: Object.freeze(Array.isArray(config.switchLog)
      ? config.switchLog.slice(-Math.max(1, Number.isFinite(config.switchLogLimit) && config.switchLogLimit >= 1
        ? Math.floor(config.switchLogLimit) : 20)).map((row) => Object.freeze({ ...row })) : []),
  });
}

/** Whether a per-session switch budget/cooldown permits another switch. */
export function canSwitch(state, rules, now = Date.now()) {
  if (!rules.enabled) return false;
  if (state.switches >= rules.maxSwitchesPerSession) return false;
  const last = state.lastSwitchAt;
  if (rules.cooldownMs > 0 && Number.isFinite(last) && now - last < rules.cooldownMs) return false;
  return true;
}

/** Append a bounded, immutable switch record for the settings page. */
export function appendSwitchLog(log, record, limit = 20) {
  const entry = Object.freeze({
    at: Number(record.at) || Date.now(),
    code: String(record.code ?? 'UNKNOWN'),
    from: record.from ? `${record.from.provider}/${record.from.model}` : 'unknown',
    to: `${record.to.provider}/${record.to.model}`,
    reason: String(record.reason ?? 'auto'),
  });
  return Object.freeze([...log, entry].slice(-Math.max(1, limit)));
}

/** Whether a normalized LlmFailure qualifies for a model switch. */
export function qualifies(failure, rules = normalizeRules()) {
  if (!rules.enabled || failure === null || typeof failure !== 'object') return false;
  const rawCode = typeof failure.code === 'string' ? failure.code : '';
  const code=rawCode==='QUOTA_EXCEEDED'?'QUOTA':rawCode==='QUEUE'?'RATE_LIMIT':rawCode==='TRUNCATED'?'STREAM_CLOSED':rawCode;
  const status = Number.isInteger(failure.status) ? failure.status : undefined;
  if (DENY_CODES.has(code)) return false;
  if (rules.triggers.includes(code)||rules.triggers.includes(rawCode)) return true;
  // HTTP_5xx and a numeric 5xx status describe an upstream failure only when
  // the machine code is generic; a terminal code above wins over the status.
  const generic = code === '' || code === 'UNKNOWN' || CUSTOM_CODE.test(code);
  if (generic && CUSTOM_CODE.test(code) && Number(code.slice(5)) >= 500) return true;
  if (generic && status !== undefined && status >= 500) return true;
  // WorkBuddy and other gateways sometimes report a generic code with quota wording.
  if (code === 'UNKNOWN' || code === '') {
    const message = typeof failure.message === 'string' ? failure.message : '';
    return QUOTA_WORDING.test(message) || (rules.triggers.includes('TRANSPORT') && TRANSPORT_WORDING.test(message));
  }
  return false;
}

export function sameSelection(a, b) {
  if (!a || !b) return false;
  return a.provider === b.provider && a.model === b.model
    && (a.reasoningEffort ?? undefined) === (b.reasoningEffort ?? undefined);
}

/** Resolve the next model after the route that just failed. */
export function nextSelection(current, rules = normalizeRules()) {
  const list = rules.priority;
  if (list.length === 0) return undefined;
  if (!current) return list[0];
  const index = list.findIndex((item) => sameSelection(item, current));
  if (index < 0) return list[0];
  return index + 1 < list.length ? list[index + 1] : undefined;
}

/** One-line, bounded failover trace for the logger. */
export function failoverSummary(from, to, code) {
  const max = 120;
  const text = `[failover] ${code}: ${from ? `${from.provider}/${from.model}` : 'unknown'} -> ${to.provider}/${to.model}; continuing`;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Whether a chain entry counts as free. Only an explicit user mark qualifies:
 * the model catalog exposes no billing metadata (dsh-api-session-controller/
 * lib/types/catalog.js returns id/name/description/reasoning/badge only).
 */
export function isFreeTier(entry) {
  return entry?.free === true;
}

/**
 * Restrict a chain to the tiers a mode permits.
 * - 'free' keeps only explicitly free tiers; an empty result means the free
 *   budget is exhausted and the session must stop rather than degrade.
 * - 'pinned' and 'off' keep the whole chain.
 */
export function chainForMode(rules, mode) {
  const list = rules?.priority ?? [];
  if (mode === 'free') return list.filter(isFreeTier);
  return list;
}

/** Normalize the per-session runtime mode into a known value. */
export function normalizeMode(mode) {
  return mode === 'pinned' || mode === 'free' ? mode : 'off';
}

/**
 * Resolve the next model after the route that just failed, honouring a mode.
 * Returns undefined when no permitted tier remains, which callers must treat
 * as "stop" rather than "fall back".
 */
export function nextSelectionForMode(current, rules, mode = 'off') {
  const list = chainForMode(rules, normalizeMode(mode));
  if (list.length === 0) return undefined;
  if (!current) return list[0];
  const index = list.findIndex((item) => sameSelection(item, current));
  if (index < 0) return list[0];
  return index + 1 < list.length ? list[index + 1] : undefined;
}

/**
 * The model a pinned session must use: the first tier of the chain.
 * Undefined when the chain is empty, which leaves the current model alone.
 */
export function pinnedSelection(rules) {
  const list = rules?.priority ?? [];
  return list.length > 0 ? list[0] : undefined;
}

/** Whether a selection is allowed while a mode is active. */
export function allowsSelection(selection, rules, mode = 'off') {
  const normalized = normalizeMode(mode);
  if (normalized === 'off') return true;
  if (selection === undefined || selection === null) return false;
  return chainForMode(rules, normalized).some((item) => sameSelection(item, selection));
}



// ---------------------------------------------------------------------------
// Exhaustion memory
//
// A quota failure says nothing about when the quota recovers, so the plugin
// remembers when a route last reported exhaustion and skips it until the
// cooldown lapses. Without this the chain restarts from its head on every
// request and keeps hitting the same spent model.
// ---------------------------------------------------------------------------

export const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Key identifying one route in the exhaustion table. */
export function routeKey(entry) {
  return entry === undefined || entry === null ? '' : entry.provider + '/' + entry.model;
}

/**
 * Normalize a persisted exhaustion table, dropping entries that are unreadable
 * or already expired. A missing table is empty, never an error.
 */
export function normalizeExhausted(value, now = Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS) {
  const table = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, stamp] of Object.entries(value)) {
      if (typeof key !== 'string' || !key.includes('/')) continue;
      const at = Number(stamp);
      if (!Number.isFinite(at) || at <= 0) continue;
      if (cooldownMs > 0 && now - at >= cooldownMs) continue;
      table[key] = at;
    }
  }
  return table;
}

/** Whether a route is still inside its exhaustion cooldown. */
export function isExhausted(table, entry, now = Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS) {
  const at = table?.[routeKey(entry)];
  if (!Number.isFinite(at)) return false;
  return cooldownMs <= 0 ? true : now - at < cooldownMs;
}

/** Record one route as exhausted at the given time. */
export function markExhausted(table, entry, now = Date.now()) {
  const key = routeKey(entry);
  if (!key) return table ?? {};
  return { ...(table ?? {}), [key]: now };
}

/**
 * Resolve the next usable route after the current one.
 * Unlike nextSelection this skips routes inside their exhaustion cooldown, so a
 * spent model is not retried until the cooldown lapses.
 */
export function nextUsableSelection(current, rules, { exhausted = {}, now = Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS, mode = 'off' } = {}) {
  const list = chainForMode(rules, normalizeMode(mode));
  if (list.length === 0) return undefined;
  const startIndex = current ? list.findIndex((item) => sameSelection(item, current)) : -1;
  // A current route that is not in the chain restarts from the head.
  const from = startIndex < 0 ? 0 : startIndex + 1;
  for (let index = from; index < list.length; index += 1) {
    if (!isExhausted(exhausted, list[index], now, cooldownMs)) return list[index];
  }
  return undefined;
}

/**
 * The first route that is not exhausted. Used when a session must be pinned to
 * a usable model instead of the chain head.
 */
export function firstUsableSelection(rules, { exhausted = {}, now = Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS, mode = 'off' } = {}) {
  const list = chainForMode(rules, normalizeMode(mode));
  for (const entry of list) {
    if (!isExhausted(exhausted, entry, now, cooldownMs)) return entry;
  }
  return undefined;
}
