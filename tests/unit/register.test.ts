// Rentgen: behaviour, security and speed of mutedit's ToolResult hook
import { test, describe, expect, mock } from 'claude-code/testing'
import { register } from '../../plugin/hooks/register.js'

const SURFACES = ['terminal', 'desktop'] as const
const STOCK = 'STOCK DRAWING'

// Patch of `hunks` hunks, each `size` lines: half added, half removed
function patch(hunks: number, size: number) {
  const lines: string[] = []
  for (let i = 0; i < size; i++) lines.push(i % 2 ? '+added line' : '-removed line')
  return Array.from({ length: hunks }, (_, i) => ({ oldStart: i * size + 1, oldLines: size, newStart: i * size + 1, newLines: size, lines }))
}

type Props = { tool: string; output: unknown; isErrored?: boolean }

// Stand in for the stock drawing beneath the mod; record what reaches it
function stand(on: any) {
  const seen: unknown[] = []
  on('ui.render', { component: 'ToolResult' }, async ($$: any, e: any) => {
    seen.push(e.props)
    const { Text } = $$.ui.resolve(e)
    return Text({ children: [STOCK] })
  })
  return seen
}

// Mount the mod on a surface and return the drawn tree and its text
let rowId = 0
async function draw($: any, surface: (typeof SURFACES)[number], p: Props, id = `toolu_${++rowId}`) {
  const props = { tool_use_id: id, isErrored: false, ...p }
  const ui = await $.ui.mount({ plugin: 'mutedit', surface, component: 'ToolResult', requestId: id, props })
  const tree = await ui.drawn()
  await ui.unmount()
  return { tree, text: (tree.children ?? []).join(''), props }
}

// Unsafe characters as the mod must never pass them to the screen
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

for (const surface of SURFACES) {
  describe(`${surface}: summary line`, () => {
    const cases: [string, Props, string][] = [
      ['edit', { tool: 'Edit', output: { filePath: 'src/a.ts', structuredPatch: patch(1, 3) } }, 'updated · src/a.ts · +1 −2'],
      ['multi edit', { tool: 'MultiEdit', output: { filePath: 'b.js', structuredPatch: patch(2, 4) } }, 'updated · b.js · +4 −4'],
      ['write over a file', { tool: 'Write', output: { type: 'update', filePath: 'c.md', structuredPatch: patch(1, 2) } }, 'updated · c.md · +1 −1'],
      ['context lines not counted', { tool: 'Edit', output: { filePath: 'd', structuredPatch: [{ lines: [' same', '+a', '\\ No newline at end of file'] }] } }, 'updated · d · +1 −0'],
      ['new file, final break', { tool: 'Write', output: { type: 'create', filePath: 'n', content: 'x\ny\n' } }, 'created · n · 2 lines'],
      ['new file, no final break', { tool: 'Write', output: { type: 'create', filePath: 'n', content: 'x\ny' } }, 'created · n · 2 lines'],
      ['new file, one line', { tool: 'Write', output: { type: 'create', filePath: 'n', content: 'x' } }, 'created · n · 1 lines'],
      ['new file, only a break', { tool: 'Write', output: { type: 'create', filePath: 'n', content: '\n' } }, 'created · n · 1 lines'],
      ['new file, empty', { tool: 'Write', output: { type: 'create', filePath: 'n', content: '' } }, 'created · n · 0 lines'],
      ['new file, old Mac CR only', { tool: 'Write', output: { type: 'create', filePath: 'n', content: 'x\ry\r' } }, 'created · n · 1 lines'],
      ['new file, CRLF', { tool: 'Write', output: { type: 'create', filePath: 'n', content: 'x\r\ny\r\n' } }, 'created · n · 2 lines'],
      ['notebook', { tool: 'NotebookEdit', output: { edit_mode: 'replace', cell_id: 'c1', notebook_path: 'nb.ipynb' } }, 'replace cell c1 · nb.ipynb'],
      ['notebook, no mode', { tool: 'NotebookEdit', output: { cell_id: 'c2', notebook_path: 'nb.ipynb' } }, 'edit cell c2 · nb.ipynb'],
    ]
    for (const [name, props, want] of cases) {
      test(`${surface}: ${name}`, async ($, on) => {
        const seen = stand(on)
        const { tree, text } = await draw($, surface, props)
        expect(text).toBe(want)
        expect(tree.type).toBe('Text')
        expect(tree.props).toMatchObject({ dimColor: true, wrap: 'truncate-middle' })
        expect(seen).toHaveLength(0)
      })
    }
  })

  describe(`${surface}: broken input does not throw`, () => {
    const broken: [string, unknown, string][] = [
      ['patch null', null, '+0 −0'],
      ['patch a string', '+a\n-b', '+0 −0'],
      ['patch an object', { lines: ['+a'] }, '+0 −0'],
      ['hunk null', [null, { lines: ['+a'] }], '+1 −0'],
      ['hunk a number', [7, { lines: ['-a'] }], '+0 −1'],
      ['lines null', [{ lines: null }, { lines: ['+a'] }], '+1 −0'],
      ['lines a string', [{ lines: '+a\n+b' }], '+0 −0'],
      ['line not a string', [{ lines: [null, 5, {}, ['+x'], '+a', '-b'] }], '+1 −1'],
      ['empty line', [{ lines: ['', '+a'] }], '+1 −0'],
    ]
    for (const [name, structuredPatch, want] of broken) {
      test(`${surface}: ${name}`, async ($, on) => {
        stand(on)
        const { text } = await draw($, surface, { tool: 'Edit', output: { filePath: 'f', structuredPatch } })
        expect(text).toBe(`updated · f · ${want}`)
      })
    }
    test(`${surface}: non-string fields`, async ($, on) => {
      stand(on)
      expect((await draw($, surface, { tool: 'Edit', output: { filePath: { a: 1 } } })).text).toBe('updated ·  · +0 −0')
      expect((await draw($, surface, { tool: 'Write', output: { type: 'create', filePath: 5, content: ['x'] } })).text).toBe('created ·  · 0 lines')
      expect((await draw($, surface, { tool: 'NotebookEdit', output: { edit_mode: 1, cell_id: [], notebook_path: null } })).text).toBe('edit cell  · ')
    })
  })

  describe(`${surface}: control characters never reach the screen`, () => {
    const paths: [string, string, string][] = [
      ['ESC color sequence', 'a\x1b[31mred\x1b[0m.ts', 'a\\x1b[31mred\\x1b[0m.ts'],
      ['newline', 'a\nb.ts', 'a\\nb.ts'],
      ['carriage return', 'a\rb.ts', 'a\\rb.ts'],
      ['tab', 'a\tb.ts', 'a\\tb.ts'],
      ['NUL and BEL', 'a\x00\x07b', 'a\\x00\\x07b'],
      ['DEL', 'a\x7fb', 'a\\x7fb'],
      ['C1 CSI', 'a\u009b31mb', 'a\\x9b31mb'],
      ['bidi override (name spoofing)', 'evil\u202ecod.sh', 'evil\\u202ecod.sh'],
      ['bidi isolates', 'a\u2066b\u2067c\u2068d\u2069', 'a\\u2066b\\u2067c\\u2068d\\u2069'],
      ['zero-width chars', 'a\u200bb\u200cc\u200dd\u200ee\u200f', 'a\\u200bb\\u200cc\\u200dd\\u200ee\\u200f'],
      ['line and paragraph separators', 'a\u2028b\u2029c', 'a\\u2028b\\u2029c'],
      ['BOM', '\ufeffa', '\\ufeffa'],
      ['lone high surrogate', 'a\ud800b', 'a\\ud800b'],
      ['lone low surrogate', 'a\udc00b', 'a\\udc00b'],
      ['emoji kept', 'ok\ud83d\ude00.ts', 'ok\ud83d\ude00.ts'],
      ['non-Latin kept', 'папка/файл.ts', 'папка/файл.ts'],
      ['OSC 8 link', '\x1b]8;;http://x\x07click\x1b]8;;\x07', '\\x1b]8;;http://x\\x07click\\x1b]8;;\\x07'],
    ]
    for (const [name, filePath, shown] of paths) {
      test(`${surface}: ${name}`, async ($, on) => {
        const seen = stand(on)
        const { text } = await draw($, surface, { tool: 'Edit', output: { filePath, structuredPatch: [] } })
        expect(text).toBe(`updated · ${shown} · +0 −0`)
        expect(UNSAFE.test(text)).toBe(false)
        expect(seen).toHaveLength(0)
      })
    }
    test(`${surface}: notebook fields escaped`, async ($, on) => {
      stand(on)
      const { text } = await draw($, surface, { tool: 'NotebookEdit', output: { edit_mode: 'x\ny', cell_id: '\x1b', notebook_path: 'n\tb' } })
      expect(text).toBe('x\\ny cell \\x1b · n\\tb')
    })
    const long: [string, string][] = [
      ['plain path of 100 000 chars', 'd/'.repeat(50_000)],
      ['path of 5000 ESC chars', '\x1b'.repeat(5000)],
      ['path of 600 emoji, odd start', 'a' + '\ud83d\ude00'.repeat(600)],
      ['path of 600 emoji', '\ud83d\ude00'.repeat(600)],
    ]
    for (const [name, filePath] of long) {
      test(`${surface}: ${name} cut to one line of at most 1000 chars`, async ($, on) => {
        stand(on)
        const { tree, text } = await draw($, surface, { tool: 'Write', output: { type: 'create', filePath, content: 'x' } })
        const path = text.slice('created · '.length, -' · 1 lines'.length)
        expect(path.length).toBeLessThanOrEqual(1000)
        expect(path.length).toBeGreaterThanOrEqual(998)
        expect(path).toContain('…')
        expect(UNSAFE.test(text)).toBe(false)
        expect(text).not.toContain('not drawn')
        expect(tree.props).toMatchObject({ wrap: 'truncate-middle' })
      })
    }
    test(`${surface}: path of exactly 1000 chars not cut`, async ($, on) => {
      stand(on)
      const filePath = 'p'.repeat(1000)
      expect((await draw($, surface, { tool: 'Edit', output: { filePath } })).text).toBe(`updated · ${filePath} · +0 −0`)
    })
  })

  describe(`${surface}: stock drawing kept`, () => {
    const pass: [string, Props][] = [
      ['errored edit', { tool: 'Edit', isErrored: true, output: { filePath: 'a', structuredPatch: patch(1, 2) } }],
      ['errored write', { tool: 'Write', isErrored: true, output: { type: 'create', filePath: 'a', content: 'x' } }],
      ['Bash', { tool: 'Bash', output: { stdout: 'hi', stderr: '', interrupted: false } }],
      ['Read', { tool: 'Read', output: { type: 'text', file: { filePath: 'a', content: 'x' } } }],
      ['plugin tool named like edit', { tool: 'edit', output: { filePath: 'a' } }],
      ['output null', { tool: 'Edit', output: null }],
      ['output undefined', { tool: 'Edit', output: undefined }],
      ['output a string', { tool: 'Write', output: 'created a' }],
      ['output a number', { tool: 'Edit', output: 0 }],
    ]
    for (const [name, props] of pass) {
      test(`${surface}: ${name}`, async ($, on) => {
        const seen = stand(on)
        const { text, props: sent } = await draw($, surface, props)
        expect(text).toBe(STOCK)
        expect(seen).toHaveLength(1)
        expect(seen[0]).toEqual(sent)
      })
    }
  })
}

// ---- speed: the hook alone, as in the baseline (stub $, no engine) ----

function hookAlone() {
  let hook: any
  register(((ev: string, _m: unknown, h: unknown) => { if (ev === 'ui.render') hook = h }) as any)
  const $ = { ui: { resolve: () => ({ Text: (p: unknown) => p }) }, store: { get: async () => undefined } }
  const next = async () => null
  return (props: Props, id = 't') => hook($, { props: { tool_use_id: id, isErrored: false, ...props } }, next)
}

// Median ms of 20 runs after 3 warm-ups
async function median(run: () => Promise<unknown>) {
  for (let i = 0; i < 3; i++) await run()
  const ms: number[] = []
  for (let i = 0; i < 20; i++) {
    const t = performance.now()
    await run()
    ms.push(performance.now() - t)
  }
  ms.sort((a, b) => a - b)
  return (ms[9] + ms[10]) / 2
}

describe('speed', () => {
  test('thresholds', async () => {
    const call = hookAlone()
    const edit = (p: unknown) => () => call({ tool: 'Edit', output: { filePath: 'a', structuredPatch: p } })
    const p10 = patch(1, 10), p10k = patch(100, 100), p100k = patch(1000, 100)
    const big = 'line\n'.repeat(1_000_000)
    const others = Array.from({ length: 1000 }, (_, i) => i % 2 ? { tool: 'Bash', output: { stdout: 'x' } } : { tool: 'Read', output: { type: 'text' } })

    const normal = await median(edit(p10))
    const k10 = await median(edit(p10k))
    const k100 = await median(edit(p100k))
    const created = await median(() => call({ tool: 'Write', output: { type: 'create', filePath: 'a', content: big } }))
    const other = await median(async () => { for (const o of others) await call(o) })
    const r = (n: number) => n.toFixed(3)
    console.log(`speed ms: normal ${r(normal)} | 10k ${r(k10)} | 100k ${r(k100)} | growth x${(k100 / k10).toFixed(1)} | create 1M ${r(created)} | 1000 others ${r(other)}`)

    expect((await call({ tool: 'Write', output: { type: 'create', filePath: 'a', content: big } }) as any).children[0]).toBe('created · a · 1000000 lines')
    expect(normal).toBeLessThan(1)
    expect(k100).toBeLessThan(5)
    expect(k100 / k10).toBeLessThanOrEqual(12)
    expect(created).toBeLessThan(20)
    expect(other).toBeLessThan(5)
  })

  test('100 000 distinct rows: each remembered once, time stays flat', async () => {
    const call = hookAlone()
    const out = { tool: 'Edit', output: { filePath: 'a', structuredPatch: patch(1, 10) } }
    const time = async (from: number, n: number) => {
      const t = performance.now()
      for (let i = from; i < from + n; i++) await call(out, `row_${i}`)
      return performance.now() - t
    }
    const first = await time(0, 10_000)
    await time(10_000, 80_000)
    const last = await time(90_000, 10_000)
    const again = await time(0, 10_000)
    console.log(`rows ms: first 10k ${first.toFixed(1)} | last 10k ${last.toFixed(1)} | 10k redrawn ${again.toFixed(1)}`)
    expect(last).toBeLessThan(first * 3 + 5)
    expect(again).toBeLessThan(first * 3 + 5)
    expect(last).toBeLessThan(200)
  })
})

// ---- /mutedit command and the on/off switch ----

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }
const EDIT: Props = { tool: 'Edit', output: { filePath: 'a.ts', structuredPatch: patch(1, 2) } }
const MUTED = 'updated · a.ts · +1 −1'

// Hooks beneath the mod for one session: start, command registry, the dialog's answer, stock drawing
function session(on: any, answer?: (question: string) => string | 'esc') {
  const registered: unknown[] = []
  const asked: unknown[] = []
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', async (_$: any, e: any) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$: any, e: any) => {
    asked.push(e.questions)
    const q = e.questions[0].question
    const a = answer ? answer(q) : 'esc'
    if (a === 'esc') return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q]: a } } }
  })
  const seen = stand(on)
  return { registered, asked, seen }
}
const start = ($: any) => $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
const run = async ($: any, args: string) => (await $.command.run({ command: 'mutedit', args, ...RUN })).text as string
const look = async ($: any, id: string) => (await draw($, 'terminal', EDIT, id)).text

describe('command', () => {
  test('registers /mutedit with a hint', async ($, on) => {
    const s = session(on)
    mock.store(on)
    await start($)
    expect(s.registered).toEqual([{ name: 'mutedit', description: expect.stringContaining('mutedit'), argumentHint: '[on|off]' }])
  })

  test('empty store: on', async ($, on) => {
    session(on); mock.store(on); await start($)
    expect(await look($, 'r1')).toBe(MUTED)
  })

  const arg: [string, string, boolean][] = [
    ['off', 'off', false], ['on', 'on', true], [' OFF ', 'off', false], ['On', 'on', true],
  ]
  for (const [given, text, on1] of arg) {
    test(`/mutedit '${given}' answers '${text}', switches new rows and is saved`, async ($, on) => {
      session(on); mock.store(on, { enabled: !on1 }); await start($)
      expect(await run($, given)).toBe(text)
      expect(await look($, 'new')).toBe(on1 ? MUTED : STOCK)
      await start($)
      expect(await look($, 'next session row')).toBe(on1 ? MUTED : STOCK)
    })
  }

  const unknown: [string, string][] = [
    ['maybe', "unknown 'maybe', use /mutedit on|off"],
    ['on off', "unknown 'on off', use /mutedit on|off"],
    ['\x1b[31mred\n', "unknown '\\x1b[31mred', use /mutedit on|off"],
    ['x\u202ey', "unknown 'x\\u202ey', use /mutedit on|off"],
  ]
  for (const [given, text] of unknown) {
    test(`/mutedit ${JSON.stringify(given)}: refused, state kept`, async ($, on) => {
      session(on); mock.store(on, { enabled: false }); await start($)
      expect(await run($, given)).toBe(text)
      expect(await look($, 'r')).toBe(STOCK)
    })
  }

  test('long unknown argument is cut to 1000 chars', async ($, on) => {
    session(on); mock.store(on); await start($)
    const text = await run($, 'z'.repeat(5000))
    expect(text.length).toBeLessThanOrEqual("unknown '', use /mutedit on|off".length + 1000)
    expect(text).toContain('…')
  })
})

describe('dialog', () => {
  const picks: [string, boolean, string, boolean][] = [
    ['On', false, 'on', true],
    ['Off', true, 'off', false],
    ['On', true, 'on', true],
  ]
  for (const [pick, before, first, after] of picks) {
    test(`was ${before ? 'on' : 'off'}, picks ${pick}`, async ($, on) => {
      const s = session(on, () => pick); mock.store(on, { enabled: before }); await start($)
      const text = await run($, '')
      const lines = text.split('\n')
      expect(lines[0]).toBe(first)
      expect(lines[1]).toBe(after ? 'New Edit, Write and NotebookEdit results show one line.' : 'New edit results show the full diff.')
      expect(text).toContain('Shows one summary line instead of the diff of Edit, Write and NotebookEdit results.')
      expect(text).toContain('/mutedit on|off')
      expect(s.asked).toHaveLength(1)
      expect(s.asked[0]).toMatchObject([{ question: `mutedit is ${before ? 'on' : 'off'}. Turn it on or off?`, header: 'mutedit', options: [{ label: 'On' }, { label: 'Off' }] }])
      expect(await look($, 'new')).toBe(after ? MUTED : STOCK)
      await start($)
      expect(await look($, 'next session row')).toBe(after ? MUTED : STOCK)
    })
  }

  test('Esc keeps the state', async ($, on) => {
    session(on, () => 'esc'); mock.store(on, { enabled: false }); await start($)
    expect((await run($, '')).split('\n')[0]).toBe('off (unchanged)')
    expect(await look($, 'r')).toBe(STOCK)
  })

  test('free text under Other keeps the state and is escaped', async ($, on) => {
    session(on, () => 'tur\x1bn\noff'); mock.store(on); await start($)
    expect((await run($, '')).split('\n')[0]).toBe("on (unchanged: 'tur\\x1bn\\noff' is not On or Off)")
    expect(await look($, 'r')).toBe(MUTED)
  })
})

describe('switch keeps rows already drawn', () => {
  test('off: old rows stay one line on redraw, new rows show the diff', async ($, on) => {
    session(on); mock.store(on); await start($)
    expect(await look($, 'old')).toBe(MUTED)
    await run($, 'off')
    expect(await look($, 'old')).toBe(MUTED)
    expect(await look($, 'new')).toBe(STOCK)
    expect(await look($, 'old')).toBe(MUTED)
  })

  test('on: old rows keep the diff on redraw, new rows are one line', async ($, on) => {
    session(on); mock.store(on, { enabled: false }); await start($)
    expect(await look($, 'old')).toBe(STOCK)
    await run($, 'on')
    expect(await look($, 'old')).toBe(STOCK)
    expect(await look($, 'new')).toBe(MUTED)
  })

   test('rows drawn before session.start (a resumed session) follow the saved state', async ($, on) => {
    session(on); mock.store(on, { enabled: false })
    expect(await look($, 'resumed row')).toBe(STOCK)
    await start($)
    expect(await look($, 'resumed row')).toBe(STOCK)
    expect(await look($, 'new')).toBe(STOCK)
  })

  test('errored rows stay stock whatever the switch', async ($, on) => {
    session(on); mock.store(on); await start($)
    const err: Props = { ...EDIT, isErrored: true }
    expect((await draw($, 'terminal', err, 'e1')).text).toBe(STOCK)
    await run($, 'off'); await run($, 'on')
    expect((await draw($, 'terminal', err, 'e1')).text).toBe(STOCK)
  })
})

describe('broken store', () => {
  const values: [string, unknown][] = [['true', true], ["'yes'", 'yes'], ['0', 0], ['an object', { enabled: false }], ['null', null], ["'false'", 'false']]
  for (const [name, value] of values) {
    test(`stored ${name} reads as on`, async ($, on) => {
      session(on); mock.store(on, { enabled: value }); await start($)
      expect(await look($, 'r')).toBe(MUTED)
    })
  }

  test('store read fails: on, no throw', async ($, on) => {
    session(on)
    on('store.get', async () => { throw new Error('disk') })
    on('store.set', async () => { throw new Error('disk') })
    await start($)
    expect(await look($, 'r1')).toBe(MUTED)
    expect(await run($, 'off')).toBe('off (not saved, this session only)')
    expect(await look($, 'r2')).toBe(STOCK)
  })
})
