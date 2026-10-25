import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage, SignalPayload } from '../types'
import { HOST_TIMEOUT_MS } from '../constants'
import { ClientSession, HostSession } from './webrtc'
import type { DataChannelLike } from './webrtc'

class FakeDataChannel implements DataChannelLike {
  sent: string[] = []
  readyState = 'open'
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null

  send(data: string): void {
    this.sent.push(data)
  }

  receive(data: string): void {
    this.onmessage?.({ data })
  }
}

class FakeRTCPeerConnection {
  onicecandidate: ((ev: { candidate: { toJSON(): unknown } }) => void) | null = null
  ondatachannel: ((ev: { channel: unknown }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  connectionState = 'new'
  closed = false
  createdChannels: { label: string; options: unknown }[] = []
  dataChannel: FakeDataChannel | null = null

  constructor(_config: RTCConfiguration) {}

  createDataChannel(label: string, options: unknown): FakeDataChannel {
    this.createdChannels.push({ label, options })
    this.dataChannel = new FakeDataChannel()
    return this.dataChannel
  }

  async setRemoteDescription(_desc: unknown): Promise<void> {}
  async setLocalDescription(_desc: unknown): Promise<void> {}
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'fake-answer' }
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'fake-offer' }
  }
  async addIceCandidate(_candidate: unknown): Promise<void> {}
  close(): void {
    this.closed = true
  }
}

function makeHost(nickname: string) {
  const pcs: FakeRTCPeerConnection[] = []
  const onSignal = vi.fn<(to: string, payload: SignalPayload) => void>()
  const onMessage = vi.fn<(msg: ChatMessage) => void>()
  const host = new HostSession({
    nickname,
    onSignal,
    onMessage,
    pcFactory: (config) => {
      const pc = new FakeRTCPeerConnection(config)
      pcs.push(pc)
      return pc as unknown as RTCPeerConnection
    },
  })
  return { host, pcs, onSignal, onMessage }
}

describe('HostSession', () => {
  it('relay assigns monotonic seq and broadcasts to all connected channels', async () => {
    const { host, pcs, onMessage } = makeHost('Host')
    const ch1 = new FakeDataChannel()
    const ch2 = new FakeDataChannel()

    await host.handleOffer('c1', 'Bob', { type: 'offer', sdp: 'offer-1' })
    pcs[0].ondatachannel?.({ channel: ch1 })
    await host.handleOffer('c2', 'Carol', { type: 'offer', sdp: 'offer-2' })
    pcs[1].ondatachannel?.({ channel: ch2 })

    host.relay('c1', 'hello', 123)
    host.relay('c2', 'world', 456)

    expect(onMessage.mock.calls[0][0]).toEqual({
      type: 'chat',
      seq: 1,
      from: 'Bob',
      text: 'hello',
      ts: 123,
    })
    expect(onMessage.mock.calls[1][0]).toEqual({
      type: 'chat',
      seq: 2,
      from: 'Carol',
      text: 'world',
      ts: 456,
    })

    const first = JSON.stringify({ type: 'chat', seq: 1, from: 'Bob', text: 'hello', ts: 123 })
    const second = JSON.stringify({ type: 'chat', seq: 2, from: 'Carol', text: 'world', ts: 456 })
    expect(ch1.sent).toEqual([first, second])
    expect(ch2.sent).toEqual([first, second])
  })

  it('broadcastSystem and broadcastPresence emit system/presence messages with incrementing seq', async () => {
    const { host, pcs, onMessage } = makeHost('Host')
    const ch = new FakeDataChannel()
    await host.handleOffer('c1', 'Bob', { type: 'offer', sdp: 'o' })
    pcs[0].ondatachannel?.({ channel: ch })

    host.broadcastSystem('Welcome')
    host.broadcastPresence([{ id: 'c1', nickname: 'Bob' }])

    expect(onMessage.mock.calls[0][0]).toMatchObject({ type: 'system', seq: 1, text: 'Welcome' })
    expect(onMessage.mock.calls[1][0]).toMatchObject({ type: 'presence', seq: 2 })
    expect(onMessage.mock.calls[1][0].text).toBe(JSON.stringify([{ id: 'c1', nickname: 'Bob' }]))
  })

  it('sendChat sets from to the host nickname', () => {
    const { host, onMessage } = makeHost('Alice')
    host.sendChat('hi all')
    expect(onMessage.mock.calls[0][0]).toMatchObject({
      type: 'chat',
      seq: 1,
      from: 'Alice',
      text: 'hi all',
    })
  })
})

describe('ClientSession', () => {
  function makeClient(hostId = 'host-id') {
    const pcs: FakeRTCPeerConnection[] = []
    const onSignal = vi.fn<(to: string, payload: SignalPayload) => void>()
    const onMessage = vi.fn<(msg: ChatMessage) => void>()
    const onDisconnect = vi.fn<() => void>()
    const onConnectFailure = vi.fn<() => void>()
    const client = new ClientSession({
      hostId,
      onSignal,
      onMessage,
      onDisconnect,
      onConnectFailure,
      pcFactory: (config) => {
        const pc = new FakeRTCPeerConnection(config)
        pcs.push(pc)
        return pc as unknown as RTCPeerConnection
      },
    })
    return { client, pcs, onSignal, onMessage, onDisconnect, onConnectFailure }
  }

  it('send sends raw chat JSON with text and ts and no seq', async () => {
    const { client, pcs } = makeClient()
    await client.connect()
    const channel = pcs[0].dataChannel as FakeDataChannel
    channel.readyState = 'open'

    client.send('hello', 999)

    expect(channel.sent).toEqual([JSON.stringify({ type: 'chat', text: 'hello', ts: 999 })])
  })

  it('connect creates a "chat" ordered data channel and emits an offer', async () => {
    const { client, pcs, onSignal } = makeClient()
    await client.connect()

    expect(pcs).toHaveLength(1)
    expect(pcs[0].createdChannels).toEqual([{ label: 'chat', options: { ordered: true } }])
    expect(onSignal).toHaveBeenCalledWith('host-id', { type: 'offer', sdp: 'fake-offer' })
  })

  it('connectionState "failed" before channel opens → onConnectFailure called, not onDisconnect', async () => {
    const { client, pcs, onDisconnect, onConnectFailure } = makeClient()
    await client.connect()
    const pc = pcs[0]

    pc.connectionState = 'failed'
    pc.onconnectionstatechange?.()

    expect(onConnectFailure).toHaveBeenCalledTimes(1)
    expect(onDisconnect).not.toHaveBeenCalled()
  })

  it('connectionState "failed" after channel opened → onDisconnect called, not onConnectFailure', async () => {
    const { client, pcs, onDisconnect, onConnectFailure } = makeClient()
    await client.connect()
    const pc = pcs[0]
    const channel = pc.dataChannel as FakeDataChannel

    channel.onopen?.()

    pc.connectionState = 'failed'
    pc.onconnectionstatechange?.()

    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(onConnectFailure).not.toHaveBeenCalled()
  })

  it('connectionState "disconnected" → onDisconnect after HOST_TIMEOUT_MS; recovery to "connected" cancels', async () => {
    vi.useFakeTimers()
    try {
      const { client, pcs, onDisconnect, onConnectFailure } = makeClient()
      await client.connect()
      const pc = pcs[0]
      const channel = pc.dataChannel as FakeDataChannel
      channel.onopen?.()

      pc.connectionState = 'disconnected'
      pc.onconnectionstatechange?.()

      vi.advanceTimersByTime(HOST_TIMEOUT_MS)
      expect(onDisconnect).toHaveBeenCalledTimes(1)
      expect(onConnectFailure).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('connectionState "disconnected" then "connected" before timeout → no disconnect', async () => {
    vi.useFakeTimers()
    try {
      const { client, pcs, onDisconnect, onConnectFailure } = makeClient()
      await client.connect()
      const pc = pcs[0]
      const channel = pc.dataChannel as FakeDataChannel
      channel.onopen?.()

      pc.connectionState = 'disconnected'
      pc.onconnectionstatechange?.()

      pc.connectionState = 'connected'
      pc.onconnectionstatechange?.()

      vi.advanceTimersByTime(HOST_TIMEOUT_MS)
      expect(onDisconnect).not.toHaveBeenCalled()
      expect(onConnectFailure).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
