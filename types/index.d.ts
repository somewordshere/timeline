/** One prompt of the conversation, placed on the timeline. */
export type TimelinePoint = {
  /** The transcript row's uuid, the `requestId` its UserMessage row draws under. */
  id: string
  /** When it was sent, epoch milliseconds. */
  at: number
  /** The prompt's text, cut to its first 2000 characters. */
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'chat-timeline': {
      points: TimelinePoint[]
      /** The id of the prompt a click is searching the desktop chat for, while it does. */
      jumping: string | null
    }
  }
}
