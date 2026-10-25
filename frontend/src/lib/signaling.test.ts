import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomInfo } from '../types'
import { SignalingClient, SignalingError } from './signaling'

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

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

const createResponse = {
  code: 'AB12CD',
  participantId: '33333333-3333-3333-3333-333333333333',
  token: '44444444-4444-4444-4444-444444444444',
  isHost: true,
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SignalingClient.createRoom', () => {
  it('POSTs to /api/rooms and returns the parsed RoomInfo', async () => {
    const fetchMock = stubFetch(200, createResponse)

    const result = await SignalingClient.createRoom('Alice')

    expect(result).toEqual(createResponse)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5080/api/rooms',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ nickname: 'Alice' }),
      }),
    )
  })

  it('throws a SignalingError with the server code on a 400 invalid_nickname', async () => {
    stubFetch(400, { error: 'invalid_nickname', message: 'Никнейм обязателен (до 20 символов)' })

    await expect(SignalingClient.createRoom('')).rejects.toMatchObject({
      code: 'invalid_nickname',
    })
  })
})

describe('SignalingClient.joinRoom', () => {
  it('POSTs to /api/rooms/{code}/join and returns the parsed RoomInfo', async () => {
    const joinResponse = { ...createResponse, isHost: false, hostId: '55555555-5555-5555-5555-555555555555' }
    const fetchMock = stubFetch(200, joinResponse)

    const result = await SignalingClient.joinRoom('AB12CD', 'Bob')

    expect(result).toEqual(joinResponse)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5080/api/rooms/AB12CD/join',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ nickname: 'Bob' }),
      }),
    )
  })

  it('throws a SignalingError with room_not_found on 404', async () => {
    stubFetch(404, { error: 'room_not_found', message: 'Комната не существует или хост офлайн' })

    await expect(SignalingClient.joinRoom('NOPE', 'Bob')).rejects.toMatchObject({
      code: 'room_not_found',
    })
  })

  it('throws a SignalingError with room_full on 409', async () => {
    stubFetch(409, { error: 'room_full', message: 'Комната заполнена (макс. 20)' })

    await expect(SignalingClient.joinRoom('AB12CD', 'Bob')).rejects.toMatchObject({
      code: 'room_full',
    })
  })
})

describe('SignalingClient.connect', () => {
  it('derives a ws:// URL from the http SIGNALING_URL and resolves on joined', async () => {
    const client = new SignalingClient()
    const onJoined = vi.fn()
    client.onJoined(onJoined)

    const promise = client.connect(room)
    const ws = FakeWebSocket.instances[0]

    expect(ws.url).toBe(
      'ws://localhost:5080/ws?room=AB12CD&participantId=11111111-1111-1111-1111-111111111111&token=22222222-2222-2222-2222-222222222222',
    )

    ws.open()
    ws.emit(joinedMessage)

    await expect(promise).resolves.toBeUndefined()
    expect(onJoined).toHaveBeenCalledWith(joinedMessage)
  })

  it('rejects the connection promise when the server sends an error message', async () => {
    const client = new SignalingClient()

    const promise = client.connect(room)
    const ws = FakeWebSocket.instances[0]

    ws.emit({ type: 'error', code: 'room_full', message: 'Комната заполнена (макс. 20)' })

    await expect(promise).rejects.toBeInstanceOf(SignalingError)
    await expect(promise).rejects.toMatchObject({ code: 'room_full' })
  })

  it('dispatches signal, presence and host_left messages to the callbacks', async () => {
    const client = new SignalingClient()
    const onSignal = vi.fn()
    const onPresence = vi.fn()
    const onHostLeft = vi.fn()
    const onError = vi.fn()
    client.onSignal(onSignal)
    client.onPresence(onPresence)
    client.onHostLeft(onHostLeft)
    client.onError(onError)

    const promise = client.connect(room)
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.emit(joinedMessage)
    await promise

    ws.emit({ type: 'signal', from: 'some-id', payload: { sdp: 'x' } })
    ws.emit({
      type: 'presence',
      participants: [{ id: 'p', nickname: 'N' }],
      event: 'join',
      participant: { id: 'p', nickname: 'N' },
    })
    ws.emit({ type: 'host_left', message: 'Хост покинул чат. Комната закрыта.' })

    expect(onSignal).toHaveBeenCalledWith('some-id', { sdp: 'x' })
    expect(onPresence).toHaveBeenCalledWith('join', { id: 'p', nickname: 'N' }, [
      { id: 'p', nickname: 'N' },
    ])
    expect(onHostLeft).toHaveBeenCalledWith('Хост покинул чат. Комната закрыта.')
    expect(onError).not.toHaveBeenCalled()
  })

  it('fires onError (without rejecting) for an error received after joined', async () => {
    const client = new SignalingClient()
    const onError = vi.fn()
    client.onError(onError)

    const promise = client.connect(room)
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.emit(joinedMessage)
    await promise

    ws.emit({ type: 'error', code: 'invalid_token', message: 'Недействительный токен или участник' })

    expect(onError).toHaveBeenCalledWith('invalid_token', 'Недействительный токен или участник')
  })
})

describe('SignalingClient.send*', () => {
  it('sendSignal and sendHeartbeat serialize the expected outbound messages', async () => {
    const client = new SignalingClient()

    const promise = client.connect(room)
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.emit(joinedMessage)
    await promise

    client.sendSignal('target-id', { candidate: 'candidate:1 1 udp 1 127.0.0.1 1 typ host' })
    client.sendHeartbeat()

    expect(ws.sent).toEqual([
      JSON.stringify({
        type: 'signal',
        to: 'target-id',
        payload: { candidate: 'candidate:1 1 udp 1 127.0.0.1 1 typ host' },
      }),
      JSON.stringify({ type: 'heartbeat' }),
    ])
  })
})

describe('SignalingClient.close', () => {
  it('closes the socket without throwing', async () => {
    const client = new SignalingClient()

    const promise = client.connect(room)
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.emit(joinedMessage)
    await promise

    expect(() => client.close()).not.toThrow()
    expect(ws.readyState).toBe(3)
  })
})
