import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomInfo } from '../types'
import { SignalingClient } from './signaling'

const room: RoomInfo = {
  code: 'AB12CD',
  participantId: '11111111-1111-1111-1111-111111111111',
  token: '22222222-2222-2222-2222-222222222222',
  isHost: true,
}

const joinedMessage = {
  type: 'joined',
  selfId: room.participantId,
  hostId: room.participantId,
  code: room.code,
  participants: [{ id: room.participantId, nickname: 'Host' }],
}

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
  }

  open(): void {
    this.readyState = 1
    this.onopen?.()
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SignalingClient heartbeat', () => {
  it('sends a heartbeat every 5s while connected', async () => {
    const client = new SignalingClient()

    const promise = client.connect(room)
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.emit(joinedMessage)
    await promise

    vi.advanceTimersByTime(5000)

    expect(ws.sent.some((raw) => JSON.parse(raw).type === 'heartbeat')).toBe(true)
  })

  it('stops sending heartbeats after close()', async () => {
    const client = new SignalingClient()

    const promise = client.connect(room)
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.emit(joinedMessage)
    await promise

    client.close()

    const sentBefore = ws.sent.length
    vi.advanceTimersByTime(15000)

    expect(ws.sent.length).toBe(sentBefore)
    expect(ws.sent.some((raw) => JSON.parse(raw).type === 'heartbeat')).toBe(false)
  })
})
