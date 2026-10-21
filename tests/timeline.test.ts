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

test('a prompt joins the timeline as a dated row with a magnified card', async $ => {
  await prompt($ as unknown as Session, 'a', 'first question')
  await prompt($ as unknown as Session, 'b', 'second question')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'chat-timeline', surface, ...PANE })
    const today = new Date()
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][today.getMonth()]!
    expect((await ui.find({ key: 'go-a' }))?.text).toContain(`${today.getDate()} ${month}`)
    expect((await ui.find({ key: 'go-b' }))?.text).not.toContain(month)
    expect(await ui.find({ text: new RegExp(String(today.getFullYear())) })).toBeDefined()
    expect(await ui.find({ key: 'zoom-b' })).toBeUndefined()
    expect(await ui.find({ text: /second question/ })).toBeDefined()
    await ui.unmount()
  }
})

test('tool results, commands and engine rows stay off the timeline', async $ => {
  await prompt($ as unknown as Session, 'c', '<command-name>/clear</command-name>')
  const ui = await $.ui.mount({ plugin: 'chat-timeline', surface: 'desktop', ...PANE })
  expect(await ui.find({ text: /No messages yet/ })).toBeDefined()
  await ui.unmount()
})

test('groups prompts when the chat outgrows the pane', async $ => {
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
