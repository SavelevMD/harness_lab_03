import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { RoomInfo } from '../types'
import ChatProvider, { useChat } from './chatStore'
import { SignalingClient, SignalingError } from '../lib/signaling'
import { HostSession, ClientSession } from '../lib/webrtc'

vi.mock('../lib/signaling', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/signaling')>()

  const MockSignalingClient: any = vi.fn(function (this: any) {
    this.connect = vi.fn(async () => {})
    this.sendSignal = vi.fn()
    this.sendHeartbeat = vi.fn()
    this.close = vi.fn()
    this.onJoined = vi.fn()
    this.onSignal = vi.fn()
    this.onPresence = vi.fn()
    this.onHostLeft = vi.fn()
    this.onError = vi.fn()
    this.onClose = vi.fn()
  })
  MockSignalingClient.createRoom = vi.fn()
  MockSignalingClient.joinRoom = vi.fn()

  return { ...actual, SignalingClient: MockSignalingClient }
})

vi.mock('../lib/webrtc', () => {
  const MockHostSession: any = vi.fn(function (this: any, opts: any) {
    this.opts = opts
    this.sendChat = vi.fn()
    this.broadcastPresence = vi.fn()
    this.broadcastSystem = vi.fn()
    this.handleOffer = vi.fn(async () => ({ type: 'answer', sdp: 'fake-answer' }))
    this.handleSignal = vi.fn()
    this.close = vi.fn()
  })
  const MockClientSession: any = vi.fn(function (this: any, opts: any) {
    this.opts = opts
    this.connect = vi.fn(async () => {})
    this.handleSignal = vi.fn()
    this.send = vi.fn()
    this.close = vi.fn()
  })
  return { HostSession: MockHostSession, ClientSession: MockClientSession }
})

const roomInfo: RoomInfo = {
  code: 'AB12CD',
  participantId: 'host-participant',
  token: 'token',
  isHost: true,
}

const joined = {
  type: 'joined',
  selfId: roomInfo.participantId,
  hostId: roomInfo.participantId,
  code: roomInfo.code,
  participants: [{ id: roomInfo.participantId, nickname: 'Alice' }],
}

const clientRoomInfo: RoomInfo = {
  code: 'AB12CD',
  participantId: 'client-participant',
  token: 'token',
  isHost: false,
  hostId: 'host-participant',
}

const clientJoined = {
  type: 'joined',
  selfId: clientRoomInfo.participantId,
  hostId: 'host-participant',
  code: clientRoomInfo.code,
  participants: [{ id: 'host-participant', nickname: 'Alice' }],
}

function signalingInstance(): any {
  return (SignalingClient as any).mock.instances[0]
}

async function connectHost() {
  vi.mocked(SignalingClient.createRoom).mockResolvedValue(roomInfo)
  const rendered = renderHook(() => useChat(), { wrapper: ChatProvider })

  await act(async () => {
    await rendered.result.current.actions.createRoom('Alice')
  })

  const signaling = signalingInstance()
  const onJoined = signaling.onJoined.mock.calls[0][0]
  await act(async () => {
    onJoined(joined)
  })

  return { rendered, signaling }
}

describe('ChatProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('createRoom happy path → chat screen, host role, connected, host participant', async () => {
    const { rendered } = await connectHost()

    expect(rendered.result.current.state.screen).toBe('chat')
    expect(rendered.result.current.state.role).toBe('host')
    expect(rendered.result.current.state.status).toBe('connected')
    expect(rendered.result.current.state.participants).toEqual([
      { id: roomInfo.participantId, nickname: 'Alice' },
    ])
  })

  it('joinRoom room_not_found → entry screen and mapped error', async () => {
    vi.mocked(SignalingClient.joinRoom).mockRejectedValue(
      new SignalingError('room_not_found', 'Комната не существует или хост офлайн'),
    )
    const rendered = renderHook(() => useChat(), { wrapper: ChatProvider })

    await act(async () => {
      await rendered.result.current.actions.joinRoom('BADCODE', 'Bob')
    })

    expect(rendered.result.current.state.screen).toBe('entry')
    expect(rendered.result.current.state.error).toBe('Комната не существует или хост офлайн')
  })

  it('joinRoom room_full → mapped error', async () => {
    vi.mocked(SignalingClient.joinRoom).mockRejectedValue(
      new SignalingError('room_full', 'Комната заполнена (макс. 20)'),
    )
    const rendered = renderHook(() => useChat(), { wrapper: ChatProvider })

    await act(async () => {
      await rendered.result.current.actions.joinRoom('AB12CD', 'Bob')
    })

    expect(rendered.result.current.state.error).toBe('Комната заполнена (макс. 20)')
  })

  it('host-left after connected → closed status and single system message', async () => {
    const { rendered, signaling } = await connectHost()
    expect(rendered.result.current.state.status).toBe('connected')

    const onHostLeft = signaling.onHostLeft.mock.calls[0][0]
    await act(async () => {
      onHostLeft('Хост покинул чат. Комната закрыта.')
    })

    expect(rendered.result.current.state.status).toBe('closed')
    expect(rendered.result.current.state.messages).toHaveLength(1)
    expect(rendered.result.current.state.messages[0]).toMatchObject({
      type: 'system',
      text: 'Хост покинул чат. Комната закрыта.',
    })
  })

  it('sendMessage with empty/too-long text does not call the session send', async () => {
    const { rendered } = await connectHost()
    const hostSession = (HostSession as any).mock.instances[0]

    act(() => {
      rendered.result.current.actions.sendMessage('')
    })
    act(() => {
      rendered.result.current.actions.sendMessage('a'.repeat(2001))
    })

    expect(hostSession.sendChat).not.toHaveBeenCalled()
    expect(rendered.result.current.state.error).toBe('Сообщение слишком длинное (макс. 2000 символов)')
  })

  it('onConnectFailure after client connects → closed status and single NAT system message', async () => {
    vi.mocked(SignalingClient.joinRoom).mockResolvedValue(clientRoomInfo)
    const rendered = renderHook(() => useChat(), { wrapper: ChatProvider })

    await act(async () => {
      await rendered.result.current.actions.joinRoom('AB12CD', 'Bob')
    })

    const signaling = signalingInstance()
    const onJoined = signaling.onJoined.mock.calls[0][0]
    await act(async () => {
      onJoined(clientJoined)
    })

    const clientSession = (ClientSession as any).mock.instances[0]
    const onConnectFailure = clientSession.opts.onConnectFailure
    await act(async () => {
      onConnectFailure()
    })

    expect(rendered.result.current.state.status).toBe('closed')
    expect(rendered.result.current.state.messages).toHaveLength(1)
    expect(rendered.result.current.state.messages[0]).toMatchObject({
      type: 'system',
      text: 'Не удалось подключиться. Попробуйте другую сеть.',
    })
  })
})
