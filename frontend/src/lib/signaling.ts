import { SIGNALING_URL } from '../constants'
import type {
  JoinedInbound,
  Participant,
  RoomInfo,
  SignalPayload,
  SignalingOutbound,
} from '../types'

export type SignalCallback = (from: string, payload: SignalPayload) => void
export type PresenceCallback = (
  event: 'join' | 'leave',
  participant: Participant,
  participants: Participant[],
) => void
export type HostLeftCallback = (message: string) => void
export type ErrorCallback = (code: string, message: string) => void
export type CloseCallback = () => void
export type JoinedCallback = (info: JoinedInbound) => void

export class SignalingError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SignalingError'
    this.code = code
  }
}

const WS_OPEN = 1

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null

  if (!response.ok) {
    const code = typeof data?.error === 'string' ? data.error : 'unknown'
    const message = typeof data?.message === 'string' ? data.message : 'Request failed'
    throw new SignalingError(code, message)
  }

  return data as T
}

function apiUrl(path: string): string {
  return `${SIGNALING_URL.replace(/\/+$/, '')}${path}`
}

function websocketUrl(base: string, room: RoomInfo): string {
  const wsBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  const params = new URLSearchParams({
    room: room.code,
    participantId: room.participantId,
    token: room.token,
  })
  return `${wsBase.replace(/\/+$/, '')}/ws?${params.toString()}`
}

export class SignalingClient {
  private socket: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private resolveConnect: ((value: void) => void) | null = null
  private rejectConnect: ((reason?: unknown) => void) | null = null

  private onSignalCb: SignalCallback | null = null
  private onPresenceCb: PresenceCallback | null = null
  private onHostLeftCb: HostLeftCallback | null = null
  private onErrorCb: ErrorCallback | null = null
  private onCloseCb: CloseCallback | null = null
  private onJoinedCb: JoinedCallback | null = null

  static async createRoom(nickname: string): Promise<RoomInfo> {
    return requestJson<RoomInfo>(apiUrl('/api/rooms'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    })
  }

  static async joinRoom(code: string, nickname: string): Promise<RoomInfo> {
    return requestJson<RoomInfo>(apiUrl(`/api/rooms/${encodeURIComponent(code)}/join`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    })
  }

  connect(room: RoomInfo): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve
      this.rejectConnect = reject

      const socket = new WebSocket(websocketUrl(SIGNALING_URL, room))
      this.socket = socket

      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), 5000)

      socket.onmessage = (event) => this.handleMessage(event)

      socket.onclose = () => {
        const pendingReject = this.rejectConnect
        this.socket = null
        this.resolveConnect = null
        this.rejectConnect = null
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer)
          this.heartbeatTimer = null
        }
        if (pendingReject) {
          pendingReject(new SignalingError('connection_closed', 'Соединение закрыто.'))
        }
        this.onCloseCb?.()
      }
    })
  }

  sendSignal(to: string, payload: SignalPayload): void {
    this.send({ type: 'signal', to, payload })
  }

  sendHeartbeat(): void {
    this.send({ type: 'heartbeat' })
  }

  onSignal(cb: SignalCallback): void {
    this.onSignalCb = cb
  }

  onPresence(cb: PresenceCallback): void {
    this.onPresenceCb = cb
  }

  onHostLeft(cb: HostLeftCallback): void {
    this.onHostLeftCb = cb
  }

  onError(cb: ErrorCallback): void {
    this.onErrorCb = cb
  }

  onClose(cb: CloseCallback): void {
    this.onCloseCb = cb
  }

  onJoined(cb: JoinedCallback): void {
    this.onJoinedCb = cb
  }

  close(): void {
    const socket = this.socket
    this.socket = null
    this.resolveConnect = null
    this.rejectConnect = null
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (socket) {
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      try {
        socket.close()
      } catch {
        // ignore close failures
      }
    }
  }

  private send(message: SignalingOutbound): void {
    if (this.socket && this.socket.readyState === WS_OPEN) {
      this.socket.send(JSON.stringify(message))
    }
  }

  private handleMessage(event: MessageEvent): void {
    let data: unknown
    try {
      data = JSON.parse(String(event.data))
    } catch {
      return
    }

    if (typeof data !== 'object' || data === null) {
      return
    }

    const message = data as Record<string, unknown>

    switch (message.type) {
      case 'joined': {
        const joined = message as unknown as JoinedInbound
        this.resolveConnect?.()
        this.resolveConnect = null
        this.rejectConnect = null
        this.onJoinedCb?.(joined)
        break
      }
      case 'signal':
        this.onSignalCb?.(
          String(message.from ?? ''),
          message.payload as SignalPayload,
        )
        break
      case 'presence':
        this.onPresenceCb?.(
          message.event as 'join' | 'leave',
          message.participant as Participant,
          (message.participants ?? []) as Participant[],
        )
        break
      case 'host_left':
        this.onHostLeftCb?.(String(message.message ?? ''))
        break
      case 'error': {
        const code = String(message.code ?? '')
        const text = String(message.message ?? '')
        const error = new SignalingError(code, text)
        if (this.rejectConnect) {
          this.rejectConnect(error)
          this.rejectConnect = null
          this.resolveConnect = null
        }
        this.onErrorCb?.(code, text)
        break
      }
      default:
        break
    }
  }
}
