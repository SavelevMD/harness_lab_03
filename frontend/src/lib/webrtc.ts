import type { Participant, ChatMessage, SignalPayload } from '../types'
import { ICE_SERVERS, DATA_CHANNEL_LABEL, HOST_TIMEOUT_MS } from '../constants'

export interface DataChannelLike {
  send(data: string): void
  readyState: string
  onopen?: (() => void) | null
  onmessage?: ((ev: { data: string }) => void) | null
  onclose?: (() => void) | null
}

interface PeerEntry {
  id: string
  nickname: string
  pc: RTCPeerConnection
  channel: DataChannelLike | null
}

export class HostSession {
  private peers: Map<string, PeerEntry> = new Map()
  private seq = 0
  private nickname: string
  private onSignal: (to: string, payload: SignalPayload) => void
  private onMessage: (msg: ChatMessage) => void
  private onClientChange?: () => void
  private pcFactory: (config: RTCConfiguration) => RTCPeerConnection

  constructor(opts: {
    nickname: string
    onSignal: (to: string, payload: SignalPayload) => void
    onMessage: (msg: ChatMessage) => void
    onClientChange?: () => void
    pcFactory?: (config: RTCConfiguration) => RTCPeerConnection
  }) {
    this.nickname = opts.nickname
    this.onSignal = opts.onSignal
    this.onMessage = opts.onMessage
    this.onClientChange = opts.onClientChange
    this.pcFactory = opts.pcFactory ?? ((config) => new RTCPeerConnection(config))
  }

  async handleOffer(
    fromId: string,
    nickname: string,
    offer: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit> {
    const pc = this.pcFactory({ iceServers: ICE_SERVERS })
    this.peers.set(fromId, { id: fromId, nickname, pc, channel: null })

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.onSignal(fromId, ev.candidate.toJSON())
      }
    }

    pc.ondatachannel = (ev) => {
      this.bindChannel(fromId, ev.channel as unknown as DataChannelLike)
    }

    await pc.setRemoteDescription(offer)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    return answer
  }

  handleSignal(fromId: string, payload: SignalPayload): void {
    const peer = this.peers.get(fromId)
    if (!peer) return

    if ('candidate' in payload) {
      peer.pc.addIceCandidate(payload)
    } else if ('type' in payload && 'sdp' in payload) {
      peer.pc.setRemoteDescription(payload)
    }
  }

  relay(fromId: string, text: string, ts: number): void {
    const peer = this.peers.get(fromId)
    const msg: ChatMessage = {
      type: 'chat',
      seq: ++this.seq,
      from: peer?.nickname,
      text,
      ts,
    }
    this.onMessage(msg)
    this.sendAll(JSON.stringify(msg))
  }

  broadcastSystem(text: string): void {
    const msg: ChatMessage = {
      type: 'system',
      seq: ++this.seq,
      text,
      ts: (Date.now() / 1000) | 0,
    }
    this.onMessage(msg)
    this.sendAll(JSON.stringify(msg))
  }

  broadcastPresence(participants: Participant[]): void {
    const msg: ChatMessage = {
      type: 'presence',
      seq: ++this.seq,
      text: JSON.stringify(participants),
      ts: (Date.now() / 1000) | 0,
    }
    this.onMessage(msg)
    this.sendAll(JSON.stringify(msg))
  }

  sendChat(text: string): void {
    const msg: ChatMessage = {
      type: 'chat',
      seq: ++this.seq,
      from: this.nickname,
      text,
      ts: (Date.now() / 1000) | 0,
    }
    this.onMessage(msg)
    this.sendAll(JSON.stringify(msg))
  }

  removeClient(id: string): void {
    const peer = this.peers.get(id)
    if (!peer) return
    peer.pc.close()
    this.peers.delete(id)
    this.onClientChange?.()
  }

  get connectedCount(): number {
    return this.peers.size
  }

  close(): void {
    for (const peer of this.peers.values()) {
      peer.pc.close()
    }
    this.peers.clear()
  }

  private bindChannel(peerId: string, channel: DataChannelLike): void {
    const peer = this.peers.get(peerId)
    if (!peer) return
    peer.channel = channel

    channel.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as { type?: string; text?: string; ts?: number }
      if (msg.type === 'chat' && typeof msg.text === 'string') {
        this.relay(peerId, msg.text, msg.ts ?? ((Date.now() / 1000) | 0))
      }
    }

    channel.onclose = () => {
      this.peers.delete(peerId)
      this.onClientChange?.()
    }
  }

  private sendAll(data: string): void {
    for (const peer of this.peers.values()) {
      if (peer.channel && peer.channel.readyState === 'open') {
        peer.channel.send(data)
      }
    }
  }
}

export class ClientSession {
  private hostId: string
  private onSignal: (to: string, payload: SignalPayload) => void
  private onMessage: (msg: ChatMessage) => void
  private onDisconnect: () => void
  private onConnectFailure?: () => void
  private pcFactory: (config: RTCConfiguration) => RTCPeerConnection
  private pc: RTCPeerConnection | null = null
  private channel: DataChannelLike | null = null
  private opened = false
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: {
    hostId: string
    onSignal: (to: string, payload: SignalPayload) => void
    onMessage: (msg: ChatMessage) => void
    onDisconnect: () => void
    onConnectFailure?: () => void
    pcFactory?: (config: RTCConfiguration) => RTCPeerConnection
  }) {
    this.hostId = opts.hostId
    this.onSignal = opts.onSignal
    this.onMessage = opts.onMessage
    this.onDisconnect = opts.onDisconnect
    this.onConnectFailure = opts.onConnectFailure
    this.pcFactory = opts.pcFactory ?? ((config) => new RTCPeerConnection(config))
  }

  async connect(): Promise<void> {
    const pc = this.pcFactory({ iceServers: ICE_SERVERS })
    this.pc = pc

    const channel = pc.createDataChannel(DATA_CHANNEL_LABEL, {
      ordered: true,
    }) as unknown as DataChannelLike
    this.channel = channel

    channel.onopen = () => {
      this.opened = true
      this.clearDisconnectTimer()
    }

    channel.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ChatMessage
      this.onMessage(msg)
    }

    channel.onclose = () => {
      this.handleDisconnect()
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.onSignal(this.hostId, ev.candidate.toJSON())
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.clearDisconnectTimer()
        this.handleDisconnect()
      } else if (pc.connectionState === 'disconnected') {
        this.scheduleDisconnect()
      } else if (pc.connectionState === 'connected') {
        this.clearDisconnectTimer()
      }
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.onSignal(this.hostId, offer)
  }

  handleSignal(payload: SignalPayload): void {
    const pc = this.pc
    if (!pc) return

    if ('candidate' in payload) {
      pc.addIceCandidate(payload)
    } else if ('sdp' in payload) {
      pc.setRemoteDescription(payload)
    }
  }

  send(text: string, ts: number): void {
    if (!this.channel || this.channel.readyState !== 'open') return
    this.channel.send(JSON.stringify({ type: 'chat', text, ts }))
  }

  close(): void {
    this.clearDisconnectTimer()
    this.pc?.close()
    this.pc = null
    this.channel = null
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null }
  }

  private scheduleDisconnect(): void {
    if (this.disconnectTimer) return
    this.disconnectTimer = setTimeout(() => {
      this.handleDisconnect()
    }, HOST_TIMEOUT_MS)
  }

  private handleDisconnect(): void {
    if (this.opened) {
      this.onDisconnect()
    } else if (this.onConnectFailure) {
      this.onConnectFailure()
    } else {
      this.onDisconnect()
    }
  }
}
