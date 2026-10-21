import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TimelinePoint } from '../types'

const PANE = 'timeline'
const TITLE = 'Timeline'
const points = atom({ plugin: 'chat-timeline', key: 'points' } as const, [] as TimelinePoint[])
const jumping = atom({ plugin: 'chat-timeline', key: 'jumping' } as const, null as string | null)

/** A ring with a turning arc in the accent colour, for the row a click is searching for. */
const SPINNER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
<circle cx="8" cy="8" r="6" fill="none" stroke="#D97757" stroke-opacity="0.25" stroke-width="2"/>
<path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="#D97757" stroke-width="2" stroke-linecap="round">
<animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.8s" repeatCount="indefinite"/>
</path>
</svg>`

const MAX_PROMPT = 2000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A run of neighbouring prompts drawn as one row when the chat outgrows the pane. */
type Mark = { first: TimelinePoint; last: TimelinePoint; count: number }

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (at: number) => new Date(at).toDateString()
const shortDay = (at: number) => `${new Date(at).getDate()} ${MONTHS[new Date(at).getMonth()]}`
const clock = (at: number) => `${pad(new Date(at).getHours())}:${pad(new Date(at).getMinutes())}`
const longDay = (at: number) => {
  const d = new Date(at)
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)
/** The one-line head of a prompt: what a row's card shows, and the key rows are matched by. */
const preview = (text: string) => text.replace(/\s+/g, ' ').slice(0, 160)

/** The text of a prompt row, or undefined for tool results, commands and the engine's own rows. */
function promptText(content: unknown): string | undefined {
  let text = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    if (content.some(block => block?.type === 'tool_result')) return undefined
    text = content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n\n')
  }
  text = text.trim()
  if (text === '' || text.startsWith('<') || text.startsWith('[Request interrupted')) return undefined
  return cap(text, MAX_PROMPT)
}

function parseTranscript(jsonl: string): TimelinePoint[] {
  const found: TimelinePoint[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"type":"user"')) continue
    try {
      const row = JSON.parse(line)
      if (row.type !== 'user' || row.isMeta || row.isSidechain) continue
      if (row.message?.role !== 'user' || typeof row.uuid !== 'string') continue
      const text = promptText(row.message.content)
      const at = Date.parse(row.timestamp)
      if (text !== undefined && !Number.isNaN(at)) found.push({ id: row.uuid, at, text })
    } catch {
      // a half-written last line
    }
  }
  return found
}

async function findTranscript($: EngineInterface, cwd: string): Promise<string | undefined> {
  const id = await $.session.id()
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : undefined)
  if (!config) return undefined
  const projects = `${config}/projects`
  const guess = `${projects}/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`
  if (await $.fs.exists(guess)) return guess
  // A long working directory is shortened in the folder name: look in every project.
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    const path = `${projects}/${entry.name}/${id}.jsonl`
    if (entry.kind === 'dir' && (await $.fs.exists(path))) return path
  }
  return undefined
}

async function readTranscript($: EngineInterface, path: string): Promise<string> {
  try {
    return await $.fs.read(path)
  } catch {
    // Over the 4 MiB read limit: let the host keep only the user rows.
    const isWindows = /^[a-zA-Z]:/.test(path)
    const argv = isWindows
      ? [
          'powershell',
          '-NoProfile',
          '-Command',
          `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Content -Encoding UTF8 -LiteralPath '${path.replace(/'/g, "''")}' | Where-Object { $_ -like '*"type":"user"*' -and $_ -notlike '*"tool_use_id"*' }`,
        ]
      : ['sh', '-c', `grep -F '"type":"user"' "$1" | grep -vF '"tool_use_id"'`, 'sh', path]
    const { stdout } = await $.process.run(argv, { timeoutMs: 60_000 })
    return stdout
  }
}

/** Fits the prompts into `rows` rows, top the first, bottom the last. */
function toMarks(list: TimelinePoint[], rows: number): Mark[] {
  if (list.length <= rows) return list.map(p => ({ first: p, last: p, count: 1 }))
  const marks: Mark[] = []
  for (let i = 0; i < rows; i++) {
    const from = Math.floor((i * list.length) / rows)
    const to = Math.floor(((i + 1) * list.length) / rows)
    const first = list[from]
    const last = list[to - 1]
    if (first && last) marks.push({ first, last, count: to - from })
  }
  return marks
}

/** requestId of each UserMessage row drawn, by its preview: the fallback when a uuid is not a row id. */
const rowByText = new Map<string, string>()

async function load($: EngineInterface, cwd: string) {
  const path = await findTranscript($, cwd)
  if (!path) return
  const list = parseTranscript(await readTranscript($, path))
  await update($, points, () => list)
}

/** Scrolls the engine's own transcript to a row, answering why not instead of throwing. */
async function scrollTo($: EngineInterface, requestId: string): Promise<string | undefined> {
  try {
    return (await $.ui.scroll({ to: { requestId }, block: 'start' })).deny
  } catch (err) {
    return String(err instanceof Error ? err.message : err)
  }
}

/**
 * The words the desktop chat shows a prompt with: its first line, markdown marks
 * dropped (the chat draws them as formatting), cut at a word near 50 characters.
 */
function openingWords(text: string): string {
  const line = (text.split('\n').find(l => l.trim() !== '') ?? text)
    .replace(/^[\s#>*\-]+/, '')
    .replace(/[*`_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (line.length <= 50) return line
  const cut = line.slice(0, 50)
  const space = cut.lastIndexOf(' ')
  return space > 15 ? cut.slice(0, space) : cut
}

/**
 * Scrolls the desktop app's chat to a prompt through Windows UI Automation
 * (`jump.ps1` beside this file): it finds the prompt's row in the Claude window,
 * or else loads the whole chat and steps down it until the row appears, and
 * scrolls it into view. No keys are sent.
 */
async function scrollDesktop($: EngineInterface, point: TimelinePoint): Promise<boolean> {
  // Windows only: elsewhere powershell does not start, and the click says so.
  const root = $.plugin.root
  const words = openingWords(point.text)
  // Which of the prompts opening with the same words this is, so "yes" lands on the right "yes".
  const twins = (await read($, points)).filter(p => openingWords(p.text) === words)
  const nth = Math.max(1, twins.findIndex(p => p.id === point.id) + 1)
  let outcome: string
  try {
    const ran = await $.process.run(
      [
        'powershell',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        `${root}/hooks/jump.ps1`,
        '-Nth',
        String(nth),
        '-Count',
        String(Math.max(1, twins.length)),
      ],
      // A long chat is stepped through a page at a time.
      { stdin: words, timeoutMs: 120_000 },
    )
    outcome = `exit ${ran.exitCode} | out: ${ran.stdout.trim()} | err: ${ran.stderr.trim()}`
    if (ran.exitCode === 0) return true
  } catch (err) {
    outcome = `could not run: ${err instanceof Error ? err.message : String(err)}`
  }
  // What the last click did, for when a jump does not land.
  await $.fs
    .write(`${root}/jump.log`, `${new Date().toISOString()} words="${words}"\n${outcome}\n`)
    .catch(() => undefined)
  return false
}

/** Brings the prompt into view: the terminal's transcript directly, the desktop app's chat through UI Automation. */
async function jump($: EngineInterface, point: TimelinePoint) {
  if ((await scrollTo($, point.id)) === undefined) return
  const rowId = rowByText.get(preview(point.text))
  if (rowId && rowId !== point.id && (await scrollTo($, rowId)) === undefined) return
  // One search at a time; its row spins while it runs.
  if ((await read($, jumping)) !== null) return
  await update($, jumping, () => point.id)
  try {
    if (await scrollDesktop($, point)) return
  } finally {
    await update($, jumping, () => null)
  }
  $.ui.toast(`Timeline: could not find the message from ${longDay(point.at)} ${clock(point.at)} in the chat`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'timeline',
      description: 'Show the chat timeline beside the conversation',
    })
    await load($, e.cwd).catch(err => $.ui.log(`chat-timeline: ${err}`, { to: 'debug' }))
    if (e.surface !== 'terminal' || e.isInteractive) {
      void $.ui.open({ id: PANE, title: TITLE, columns: 24 })
    }
    return started
  })

  on('command.run', { command: 'timeline' }, async ($, e) => {
    await load($, await $.session.cwd()).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE, columns: 24 })
    return { text: 'Timeline opened.' }
  })

  // A new prompt joins the timeline as it is stored.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door === 'prompt' && !e.agentId) {
      const text = promptText(e.message.content)
      if (text !== undefined) {
        const point: TimelinePoint = { id: e.uuid, at: Date.now(), text }
        await update($, points, list => [...(list ?? []).filter(p => p.id !== point.id), point])
      }
    }
    return stored
  }).catch(($, e, next) => next(e))

  // Remembers which row draws which prompt; draws nothing of its own.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const text = promptText(e.props.text)
    if (text !== undefined) rowByText.set(preview(text), e.requestId)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const list = await read($, points)
    const busy = await read($, jumping)

    if (e.props.view.agentId) {
      return <Text dimColor>The timeline follows the main conversation.</Text>
    }
    if (list.length === 0) {
      return <Text dimColor>No messages yet.</Text>
    }

    const width = Math.max(10, e.props.bodyColumns)
    // Room for the rows plus the three a hovered row grows by.
    const rows = Math.max(3, e.props.scroll.bodyRows - 4)
    const marks = toMarks(list, rows)

    return (
      <Box flexDirection="column" width={width}>
        {marks.map((mark, i) => {
          const at = mark.first.at
          const before = marks[i - 1]
          const isNewDay = !before || dayKey(before.first.at) !== dayKey(at)
          const go = () => jump($, mark.first)
          const isBusy = busy === mark.first.id
          const range =
            mark.count === 1
              ? clock(at)
              : dayKey(at) === dayKey(mark.last.at)
                ? `${clock(at)}–${clock(mark.last.at)} · ${mark.count} msgs`
                : `→ ${shortDay(mark.last.at)} · ${mark.count} msgs`

          // One Button per row is the click target. Hovering the row grows it in
          // place: the date turns accent-coloured and bold, and a larger date with
          // the message's first words opens beneath it, pushing the rows below down.
          // Nothing is painted over the Button, so a click always reaches it.
          return (
            <Box key={`row-${mark.first.id}`} flexDirection="column" width={width}>
              <Button key={`go-${mark.first.id}`} plain onPress={go}>
                <Text
                  color={isBusy ? 'claude' : isNewDay ? 'text' : 'subtle'}
                  size={isNewDay ? 'footnote' : 'caption'}
                  tabular
                  hover={{ color: 'claude', bold: true }}
                >
                  {isNewDay ? `━ ${shortDay(at)}` : '│'}
                </Text>
                <Text dimColor size="caption" tabular hover={{ color: 'claude', dimColor: false, bold: true }}>
                  {' '}
                  {clock(at)}
                </Text>
              </Button>
              {isBusy ? (
                <Box key={`busy-${mark.first.id}`} flexDirection="row" alignItems="center" paddingLeft={2} width={width}>
                  {Svg ? <Svg source={SPINNER} alt="Searching the chat" width={12} height={12} isInteractive /> : null}
                  <Text size="caption" color="claude">
                    {' '}
                    Finding in chat…
                  </Text>
                </Box>
              ) : null}
              <Box display="none" hover={{ display: 'flex' }} flexDirection="column" paddingLeft={2} width={width}>
                <Text size="heading" weight="bold" color="claude">
                  {longDay(at)}
                </Text>
                <Text size="footnote" tabular>
                  {range}
                </Text>
                <Text size="footnote" dimColor wrap="truncate-end">
                  {preview(mark.first.text)}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
