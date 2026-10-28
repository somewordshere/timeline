import { expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'timeline',
  viewport: { columns: 120, rows: 30 },
  props: {
    title: 'Timeline',
    isFocused: false,
    bodyColumns: 24,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

type Session = { session: { append: (row: unknown) => Promise<unknown> } }

/** Raises the person's prompt as a session stores it. */
const prompt = ($: Session, uuid: string, text: string) =>
  $.session.append({
    door: 'prompt',
    uuid,
    origin: { kind: 'composer' },
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
  })

test('a prompt joins the timeline as a dated row with a magnified card', { options: { hoverCard: true } }, async $ => {
  await prompt($ as unknown as Session, 'a', 'first question')
  await prompt($ as unknown as Session, 'b', 'second question')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'chat-timeline', surface, ...PANE })
    const today = new Date()
    const month = today.toLocaleString('en', { month: 'long' })
    expect((await ui.find({ key: 'day-a' }))?.text).toContain(`${today.getDate()} ${month}`)
    expect((await ui.find({ key: 'go-a' }))?.text).not.toContain(month)
    expect(await ui.find({ key: 'day-b' })).toBeUndefined()
    expect((await ui.find({ key: 'go-b' }))?.text).not.toContain(month)
    expect((await ui.find({ key: 'arrow-b' }))?.text).toContain('go to message')
    expect(await ui.find({ text: new RegExp(String(today.getFullYear())) })).toBeDefined()
    expect(await ui.find({ key: 'zoom-b' })).toBeUndefined()
    expect(await ui.find({ text: /second question/ })).toBeDefined()
    await ui.unmount()
  }
})

test('settings: a 12-hour clock and short month names', { options: { clock: '12-hour', monthNames: 'short' } }, async $ => {
  await prompt($ as unknown as Session, 'a', 'first question')
  const ui = await $.ui.mount({ plugin: 'chat-timeline', surface: 'desktop', ...PANE })
  const today = new Date()
  const full = today.toLocaleString('en', { month: 'long' })
  const day = (await ui.find({ key: 'day-a' }))?.text
  expect(day).toContain(`${today.getDate()} ${full.slice(0, 3)}`)
  if (full.length > 3) expect(day).not.toContain(full)
  expect((await ui.find({ key: 'go-a' }))?.text).toMatch(/\d:\d\d (AM|PM)/)
  await ui.unmount()
})

test('settings: the preview always below each time, outside the card', { options: { preview: 'always below time' } }, async $ => {
  await prompt($ as unknown as Session, 'a', 'first question')
  const ui = await $.ui.mount({ plugin: 'chat-timeline', surface: 'desktop', ...PANE })
  expect((await ui.find({ key: 'text-a' }))?.text).toContain('first question')
  expect((await ui.findAll({ type: 'Text', text: /first question/ })).length).toBe(1)
  await ui.unmount()
})

test('settings: medium messages below each time by default', async $ => {
  await prompt($ as unknown as Session, 'a', 'first question')
  const ui = await $.ui.mount({ plugin: 'chat-timeline', surface: 'desktop', ...PANE })
  const words = await ui.findAll({ type: 'Text', text: /first question/ })
  expect(words.map(w => w.props.size)).toEqual(['footnote'])
  // No hover card by default: the arrow alone answers a hover.
  expect(await ui.find({ text: new RegExp(String(new Date().getFullYear())) })).toBeUndefined()
  expect((await ui.find({ key: 'arrow-a' }))?.text).toContain('go to message')
  await ui.unmount()
})

test('settings: large messages, the time unchanged', { options: { preview: 'always below time', messageSize: 'large' } }, async $ => {
  await prompt($ as unknown as Session, 'a', 'first question')
  const ui = await $.ui.mount({ plugin: 'chat-timeline', surface: 'desktop', ...PANE })
  const words = await ui.findAll({ type: 'Text', text: /first question/ })
  expect(words.map(w => w.props.size)).toEqual(['body'])
  expect(JSON.stringify((await ui.find({ key: 'go-a' }))?.children)).toContain('footnote')
  await ui.unmount()
})

test('settings: no preview and no hover card', { options: { preview: 'hidden', hoverCard: false } }, async $ => {
  await prompt($ as unknown as Session, 'a', 'first question')
  const ui = await $.ui.mount({ plugin: 'chat-timeline', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'text-a' })).toBeUndefined()
  expect(await ui.find({ text: /first question/ })).toBeUndefined()
  expect(await ui.find({ text: new RegExp(String(new Date().getFullYear())) })).toBeUndefined()
  expect((await ui.find({ key: 'arrow-a' }))?.text).toContain('go to message')
  await ui.unmount()
})

test('/timeline changes a setting, lists them, and names the choices', async ($, on) => {
  // The kit has no settings to write: record what the command saves.
  const saved: { key: string; value: unknown }[] = []
  on('config.set', (_$, e) => {
    saved.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  const run = async (args: string) => JSON.stringify(await $.command.run({ command: 'timeline', args }))
  expect(await run('preview off')).toContain('preview set to hidden')
  expect(saved).toEqual([{ key: 'chat-timeline.preview', value: 'hidden' }])
  expect(await run('card on')).toContain('card set to on')
  expect(saved[1]).toEqual({ key: 'chat-timeline.hoverCard', value: true })
  expect(await run('settings')).toContain('messages  medium')
  expect(await run('colour red')).toContain('Unknown setting')
  expect(await run('messages huge')).toContain('not a choice')
})


test('tool results, commands and engine rows stay off the timeline', async $ => {
  await prompt($ as unknown as Session, 'c', '<command-name>/clear</command-name>')
  const ui = await $.ui.mount({ plugin: 'chat-timeline', surface: 'desktop', ...PANE })
  expect(await ui.find({ text: /No messages yet/ })).toBeDefined()
  await ui.unmount()
})

test('groups prompts when the chat outgrows the pane', { options: { hoverCard: true } }, async $ => {
  for (let i = 0; i < 60; i++) await prompt($ as unknown as Session, `p${i}`, `question ${i}`)

  const ui = await $.ui.mount({ plugin: 'chat-timeline', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-p0' })).toBeDefined()
  expect(await ui.find({ key: 'go-p59' })).toBeUndefined()
  expect(await ui.find({ text: /msgs/ })).toBeDefined()
  await ui.unmount()
})

test('a click that cannot reach the message says so, on every surface', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  await prompt($ as unknown as Session, 'm1', 'first ask')

  // The kit has no transcript to scroll and no Claude window to reach.
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'chat-timeline', surface, ...PANE })
    expect(await ui.press({ key: 'go-m1' })).toEqual({ element: 'go-m1' })
    await ui.unmount()
  }
  expect(toasts.length).toBe(2)
  expect(toasts[0]).toContain('could not find the message')
})

test('the clicked row spins while the chat is searched, and stops after', async ($, on) => {
  // The search itself: what the pane draws while it runs.
  let look: (() => Promise<string | undefined>) | undefined
  let during: string | undefined
  on('process.run', async () => {
    during = await look?.()
    return { value: { exitCode: 0, stdout: 'found', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await prompt($ as unknown as Session, 's1', 'an old question')
  const ui = await $.ui.mount({ plugin: 'chat-timeline', surface: 'desktop', ...PANE })
  look = async () => (await ui.find({ key: 'busy-s1' }))?.text
  expect(await look()).toBeUndefined()
  await ui.press({ key: 'go-s1' })
  expect(during).toContain('Finding in chat')
  expect(await look()).toBeUndefined()
  await ui.unmount()
})
