export type Role = 'host' | 'client'

export interface Participant {
  id: string
  nickname: string
}

export interface RoomInfo {
  code: string
  participantId: string
  token: string
  isHost: boolean
  hostId?: string
}

export type ChatMessageType = 'chat' | 'system' | 'presence'

export interface ChatMessage {
  type: ChatMessageType
  seq: number
  from?: string
  text: string
  ts: number
}

export type SignalPayload = RTCSessionDescriptionInit | RTCIceCandidateInit

// ---- Server -> client signaling messages ----

export interface JoinedInbound {
  type: 'joined'
  selfId: string
  hostId: string
  code: string
  participants: Participant[]
}

export interface SignalInbound {
  type: 'signal'
  from: string
  payload: SignalPayload
}

export interface PresenceInbound {
  type: 'presence'
  participants: Participant[]
  event: 'join' | 'leave'
  participant: Participant
}

export interface HostLeftInbound {
  type: 'host_left'
  message: string
}

export interface ErrorInbound {
  type: 'error'
  code: string
  message: string
}

export type SignalingInbound =
  | JoinedInbound
  | SignalInbound
  | PresenceInbound
  | HostLeftInbound
  | ErrorInbound

// ---- Client -> server signaling messages ----

export interface SignalOutbound {
  type: 'signal'
  to: string
  payload: SignalPayload
}

export interface HeartbeatOutbound {
  type: 'heartbeat'
}

export type SignalingOutbound = SignalOutbound | HeartbeatOutbound
