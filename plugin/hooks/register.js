// Draws one summary line in place of the diff for file-editing tool results and Bash file changes
const TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Count added and removed lines in structuredPatch hunks; broken parts are skipped
function countLines(patch) {
  let add = 0, del = 0
  if (!Array.isArray(patch)) return { add, del }
  for (const hunk of patch) {
    const lines = hunk?.lines
    if (!Array.isArray(lines)) continue
    for (const line of lines) {
      if (typeof line !== 'string') continue
      if (line[0] === '+') add++
      else if (line[0] === '-') del++
    }
  }
  return { add, del }
}

// Count text lines without copying the text; a final line break opens no new line
function textLines(text) {
  if (typeof text !== 'string' || text === '') return 0
  let n = 1
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++
  return text.endsWith('\n') ? n - 1 : n
}

// Characters that move the cursor, break the line or hide and reorder text:
// C0, DEL, C1, zero-width, line and paragraph separators, bidi controls, BOM, lone surrogates
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
const ESCAPES = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }
const MAX = 1000

function escape(c) {
  const code = c.charCodeAt(0)
  return ESCAPES[c] ?? (code < 0x100 ? '\\x' + code.toString(16).padStart(2, '0') : '\\u' + code.toString(16).padStart(4, '0'))
}

// Move a cut out of the middle of a surrogate pair, toward the cut-out part
const high = code => code >= 0xd800 && code <= 0xdbff
const headEnd = (text, i) => high(text.charCodeAt(i - 1)) ? i - 1 : i
const tailStart = (text, i) => high(text.charCodeAt(i - 1)) ? i + 1 : i

// Show unsafe characters as visible escapes and cut the middle out of a long value,
// so one line stays one line and shows what it really holds
function safe(value) {
  if (typeof value !== 'string') return ''
  const text = value.replace(UNSAFE, escape)
  if (text.length <= MAX) return text
  const half = (MAX - 1) / 2
  return text.slice(0, headEnd(text, Math.ceil(half))) + '…' + text.slice(tailStart(text, text.length - Math.floor(half)))
}

function summary(tool, out) {
  const path = safe(out.filePath ?? out.notebook_path)
  if (tool === 'NotebookEdit') return `${safe(out.edit_mode) || 'edit'} cell ${safe(out.cell_id)} · ${path}`
  if (tool === 'Write' && out.type === 'create') return `created · ${path} · ${textLines(out.content)} lines`
  const { add, del } = countLines(out.structuredPatch)
  return `updated · ${path} · +${add} −${del}`
}

// One line per file a Bash command changed, from the bashEditDiff the engine keeps
// for drawing (an internal field: when it is missing or empty, Bash keeps the stock drawing)
function bashSummaries(diff) {
  const files = Array.isArray(diff?.files) ? diff.files.filter(f => f && typeof f === 'object') : []
  const rows = files.map(f => {
    const path = safe(f.filePath)
    const { add, del } = countLines(f.hunks)
    if (f.created === true) return `created · ${path} · ${add} lines`
    if (f.deleted === true) return `deleted · ${path} · ${del} lines`
    return `updated · ${path} · +${add} −${del}`
  })
  // Files changed with no diff to show (too large, binary, mode only): named from changedFiles
  let more = Number.isInteger(diff?.moreFiles) && diff.moreFiles > 0 ? diff.moreFiles : 0
  const shown = new Set(files.map(f => f.filePath))
  const named = Array.isArray(diff?.changedFiles) ? diff.changedFiles : []
  for (const path of new Set(named)) {
    if (more === 0) break
    if (typeof path !== 'string' || shown.has(path)) continue
    rows.push(`changed · ${safe(path)}`)
    more--
  }
  if (more) rows.push(`… ${more} more files`)
  return rows
}

const GUTTER = '  ⎿  '
const PREFIX = 'Muted it: '

// On or off for new rows; read from the store once per session, saved across sessions
const KEY = 'enabled'
let enabled = true
let loaded

// Read the saved state; a resumed session draws its rows before session.start, so drawing waits for this too
function load($, again) {
  if (again || !loaded) {
    loaded = Promise.resolve()
      .then(() => $.store.get(KEY))
      .then(v => { enabled = v !== false }, () => { enabled = true })
  }
  return loaded
}
// What each row showed when first drawn, so a switch changes only rows drawn after it
const shown = new Map()

const HELP = 'Shows one summary line instead of the diff of Edit, Write and NotebookEdit results and of files a Bash command changed.'
const USAGE = '/mutedit on|off switches without the dialog.'
const state = () => (enabled ? 'on' : 'off')

// Switch for new rows and save; a failed save keeps the switch for this session
async function turn($, on) {
  await load($)
  enabled = on
  try {
    await $.store.set(KEY, on)
    return state()
  } catch {
    return `${state()} (not saved, this session only)`
  }
}

async function menu($) {
  const was = enabled
  let answer
  try {
    answer = await $.ui.ask(`mutedit is ${was ? 'on' : 'off'}. Turn it on or off?`, { options: ['On', 'Off'], header: 'mutedit' })
  } catch {
    answer = undefined
  }
  let line
  if (answer === 'On' || answer === 'Off') line = await turn($, answer === 'On')
  else if (answer === undefined) line = `${state()} (unchanged)`
  else line = `${state()} (unchanged: '${safe(answer)}' is not On or Off)`
  const what = enabled ? 'New edit results show one line.' : 'New edit results show the full diff.'
  return [line, what, HELP, USAGE].join('\n')
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await load($, true)
    await $.command.register({ name: 'mutedit', description: 'Show or switch mutedit: one line instead of edit diffs', argumentHint: '[on|off]' })
    return next(e)
  })

  on('command.run', { command: 'mutedit' }, async ($, e) => {
    await load($)
    const arg = typeof e.args === 'string' ? e.args.trim().toLowerCase() : ''
    if (arg === '') return { text: await menu($) }
    if (arg === 'on' || arg === 'off') return { text: await turn($, arg === 'on') }
    return { text: `unknown '${safe(e.args.trim())}', use /mutedit on|off` }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { tool_use_id: id, tool, output, isErrored } = e.props ?? {}
    // Errors and other tools keep the stock drawing
    if (isErrored || !output || typeof output !== 'object') return next(e)
    const bash = tool === 'Bash' ? bashSummaries(output.bashEditDiff) : null
    if (!TOOLS.has(tool) && !bash?.length) return next(e)
    let muted = shown.get(id)
    if (muted === undefined) {
      await load($)
      muted = enabled
      shown.set(id, muted)
    }
    if (!muted) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // In the terminal a result block opens with the same gutter as the stock one
    const lead = (e.surface === 'terminal' ? GUTTER : '') + PREFIX
    const line = text => Text({ dimColor: true, wrap: 'truncate-middle', children: [lead + text] })
    if (!bash) return line(summary(tool, output))
    // Bash: the stock drawing of the command's output without the diff, then one line per file
    const { bashEditDiff, ...rest } = output
    const stock = await next({ ...e, props: { ...e.props, output: rest } })
    return Box({ flexDirection: 'column', children: [stock, ...bash.map(line)] })
  })
}
