// DSH host tool boundary. This module never executes tools or changes permissions.
// Only tools supplied in the current GenerateOptions may become tool-call blocks.
export function visibleTools(tools) {
  if (!Array.isArray(tools)) return []
  const names = new Set()
  const result = []
  for (const item of tools) {
    const fn = item?.type === 'function' && item.function ? item.function : item
    if (!fn || typeof fn.name !== 'string' || !fn.name.trim() || names.has(fn.name)) continue
    names.add(fn.name)
    const schema = fn.parameters ?? fn.inputSchema ?? fn.input_schema
    result.push({ name: fn.name, description: typeof fn.description === 'string' ? fn.description : '',
      parameters: schema && typeof schema === 'object' && !Array.isArray(schema)
        ? schema : { type: 'object', properties: {} },
      ...(typeof fn.strict === 'boolean' ? { strict: fn.strict } : {}) })
  }
  return result
}

export function openAiTools(tools) {
  return visibleTools(tools).map(({ name, description, parameters, strict }) => ({
    type: 'function', function: { name, description, parameters, ...(strict === undefined ? {} : { strict }) },
  }))
}

export function stringifyToolValue(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (Array.isArray(value)) return value.map((part) =>
    typeof part?.text === 'string' ? part.text : stringifyToolValue(part?.content ?? part)).join('\n')
  try { return JSON.stringify(value) } catch { return '[unserializable tool value]' }
}

export function normalizedArguments(value) {
  let parsed = value
  if (typeof parsed === 'string') {
    if (!parsed.trim()) parsed = {}
    else {
      try { parsed = JSON.parse(parsed) } catch { return null }
    }
  }
  if (parsed === undefined || parsed === null) parsed = {}
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return null
  try { return JSON.stringify(parsed) } catch { return null }
}

const OPEN = '<dsh_tool>'
const CLOSE = '</dsh_tool>'
const MARKERS = /<dsh_tool>([\s\S]*?)<\/dsh_tool>/g
const MAX_TOOL_TEXT = 131072
const MAX_CALLS = 8

/** Recognize only explicit protocol tags or a complete tool-call JSON response.
 * A quoted example in ordinary prose must never be turned into an action.
 * The DSH host remains the sole executor / permission authority.
 */
export function recoverHostToolCalls(text, tools) {
  if (typeof text !== 'string') return { status: 'none', calls: [] }
  if (text.length > MAX_TOOL_TEXT) return {
    status: text.includes(OPEN) || text.includes('"type":"tool-call"') ? 'invalid' : 'none',
    calls: [], message: 'Tool response exceeded the safe size limit',
  }
  const allowed = new Set(visibleTools(tools).map((tool) => tool.name))
  const marked = [...text.matchAll(MARKERS)]
  const hasMarker = text.includes(OPEN) || text.includes(CLOSE)
  let raw = []
  if (hasMarker) {
    if (!marked.length || marked.length > MAX_CALLS ||
        text.replace(MARKERS, '').includes(OPEN) || text.replace(MARKERS, '').includes(CLOSE)) {
      return { status: 'invalid', calls: [], message: 'Malformed DSH tool marker' }
    }
    for (const match of marked) {
      try { raw.push(JSON.parse(match[1])) }
      catch { return { status: 'invalid', calls: [], message: 'Malformed tool-call JSON' } }
    }
  } else {
    let trimmed = text.trim()
    const fence = /^\x60\x60\x60(?:json)?\s*\n([\s\S]*?)\n\x60\x60\x60$/i.exec(trimmed)
    if (fence) trimmed = fence[1].trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return { status: 'none', calls: [] }
    let obj
    try { obj = JSON.parse(trimmed) } catch {
      return trimmed.includes('"type":"tool-call"') || trimmed.includes('"type": "tool-call"')
        ? { status: 'invalid', calls: [], message: 'Incomplete or malformed tool-call JSON' }
        : { status: 'none', calls: [] }
    }
    const list = Array.isArray(obj) ? obj : [obj]
    if (!list.length || !list.every((call) => call && typeof call === 'object' && call.type === 'tool-call'))
      return { status: 'none', calls: [] }
    if (list.length > MAX_CALLS) return { status: 'invalid', calls: [], message: 'Too many tool calls' }
    raw = list
  }
  if (!raw.length) return { status: 'none', calls: [] }
  if (!allowed.size) return { status: 'invalid', calls: [], message: 'No host tools are available in this turn' }
  const calls = []
  for (const item of raw) {
    const name = item?.name
    if (typeof name !== 'string' || !allowed.has(name)) {
      return { status: 'invalid', calls: [], message: 'Tool is not available in this DSH session: ' + String(name ?? '') }
    }
    const args = normalizedArguments(item.arguments)
    if (args === null) return { status: 'invalid', calls: [], message: 'Invalid JSON tool arguments for ' + name }
    calls.push({ name, arguments: args })
  }
  return { status: 'calls', calls }
}

export function removeToolMarkers(text) {
  return String(text ?? '').replace(MARKERS, '').trim()
}