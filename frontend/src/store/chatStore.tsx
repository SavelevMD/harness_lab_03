import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import type { Role, Participant, RoomInfo, ChatMessage, JoinedInbound } from '../types'
import { ERROR_MESSAGES } from '../constants'
import { validateNickname, validateMessage, mapJoinError } from '../lib/validation'
import { SignalingClient, SignalingError } from '../lib/signaling'
import { HostSession, ClientSession } from '../lib/webrtc'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'closed'

export interface ChatState {
  screen: 'entry' | 'chat'
  nickname: string
  role: Role | null
  room: RoomInfo | null
  participants: Participant[]
  messages: ChatMessage[]
  status: ConnectionStatus
  error: string | null
}

export interface ChatActions {
  setNickname: (n: string) => void
  createRoom: (nickname: string) => Promise<void>
  joinRoom: (code: string, nickname: string) => Promise<void>
  sendMessage: (text: string) => void
  leave: () => void
}

type Action =
  | { type: 'SET_NICKNAME'; nickname: string }
  | { type: 'CONNECTING'; nickname: string }
  | { type: 'SET_ROOM'; room: RoomInfo; role: Role; participants: Participant[] }
  | { type: 'JOINED'; participants: Participant[] }
  | { type: 'SET_STATUS'; status: ConnectionStatus }
  | { type: 'SET_PARTICIPANTS'; participants: Participant[] }
  | { type: 'APPEND_MESSAGE'; message: ChatMessage }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'JOIN_FAILED'; error: string }
  | { type: 'HOST_LEFT' }
  | { type: 'CONNECTION_FAILED' }
  | { type: 'RESET' }

const initialState: ChatState = {
  screen: 'entry',
  nickname: '',
  role: null,
  room: null,
  participants: [],
  messages: [],
  status: 'idle',
  error: null,
}

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case 'SET_NICKNAME':
      return { ...state, nickname: action.nickname }
    case 'CONNECTING':
      return {
        ...state,
        nickname: action.nickname,
        screen: 'chat',
        status: 'connecting',
        error: null,
      }
    case 'SET_ROOM':
      return {
        ...state,
        room: action.room,
        role: action.role,
        participants: action.participants,
      }
    case 'JOINED':
      return { ...state, participants: action.participants, status: 'connected' }
    case 'SET_STATUS':
      return { ...state, status: action.status }
    case 'SET_PARTICIPANTS':
      return { ...state, participants: action.participants }
    case 'APPEND_MESSAGE': {
      const messages = [...state.messages, action.message].sort((a, b) => a.seq - b.seq)
      return { ...state, messages }
    }
    case 'SET_ERROR':
      return { ...state, error: action.error }
    case 'JOIN_FAILED':
      return {
        ...state,
        screen: 'entry',
        status: 'closed',
        error: action.error,
        room: null,
        role: null,
        participants: [],
      }
    case 'HOST_LEFT': {
      const system: ChatMessage = {
        type: 'system',
        seq: 0,
        text: ERROR_MESSAGES.host_left,
        ts: (Date.now() / 1000) | 0,
      }
      return { ...state, status: 'closed', participants: [], messages: [system] }
    }
    case 'CONNECTION_FAILED': {
      const system: ChatMessage = {
        type: 'system',
        seq: 0,
        text: ERROR_MESSAGES.nat_failure,
        ts: (Date.now() / 1000) | 0,
      }
      return { ...state, status: 'closed', participants: [], messages: [system] }
    }
    case 'RESET':
      return initialState
  }
}

interface ChatContextValue {
  state: ChatState
  actions: ChatActions
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const stateRef = useRef(initialState)
  const signalingRef = useRef<SignalingClient | null>(null)
  const sessionRef = useRef<HostSession | ClientSession | null>(null)
  const roomRef = useRef<RoomInfo | null>(null)
  const roleRef = useRef<Role | null>(null)
  const nicknameRef = useRef('')
  const leftRef = useRef(false)

  useEffect(() => {
    stateRef.current = state
  })

  const nicknameOf = (id: string): string => {
    const participant = stateRef.current.participants.find((p) => p.id === id)
    return participant ? participant.nickname : id
  }

  const appendMessage = (message: ChatMessage): void => {
    if (message.type === 'presence') {
      try {
        const participants = JSON.parse(message.text) as Participant[]
        dispatch({ type: 'SET_PARTICIPANTS', participants })
      } catch {
        // ignore malformed presence payloads
      }
      return
    }
    dispatch({ type: 'APPEND_MESSAGE', message })
  }

  const handleHostLeft = (): void => {
    const signaling = signalingRef.current
    const session = sessionRef.current
    signalingRef.current = null
    sessionRef.current = null
    session?.close()
    signaling?.close()
    dispatch({ type: 'HOST_LEFT' })
  }

  const handleConnectFailure = (): void => {
    const signaling = signalingRef.current
    const session = sessionRef.current
    signalingRef.current = null
    sessionRef.current = null
    session?.close()
    signaling?.close()
    dispatch({ type: 'CONNECTION_FAILED' })
  }

  const handleJoinError = (e: unknown): void => {
    let message: string
    if (e instanceof SignalingError) {
      message = mapJoinError(e.code)
    } else if (e instanceof Error) {
      message = e.message
    } else {
      message = mapJoinError('unknown')
    }
    roomRef.current = null
    roleRef.current = null
    dispatch({ type: 'JOIN_FAILED', error: message })
  }

  const attachCallbacks = (signaling: SignalingClient): void => {
    signaling.onJoined((info: JoinedInbound) => {
      dispatch({ type: 'JOINED', participants: info.participants })

      if (roleRef.current === 'host') {
        const session = new HostSession({
          nickname: nicknameRef.current,
          onSignal: (to, payload) => signaling.sendSignal(to, payload),
          onMessage: appendMessage,
          onClientChange: () => {},
        })
        sessionRef.current = session
      } else {
        const hostId = roomRef.current?.hostId
        if (!hostId) return
        const session = new ClientSession({
          hostId,
          onSignal: (to, payload) => signaling.sendSignal(to, payload),
          onMessage: appendMessage,
          onDisconnect: handleHostLeft,
          onConnectFailure: handleConnectFailure,
        })
        sessionRef.current = session
        void session.connect()
      }
    })

    signaling.onSignal((from, payload) => {
      const session = sessionRef.current
      if (!session) return

      if (roleRef.current === 'host') {
        const hostSession = session as HostSession
        if ('type' in payload && payload.type === 'offer' && 'sdp' in payload) {
          hostSession
            .handleOffer(from, nicknameOf(from), payload)
            .then((answer) => signaling.sendSignal(from, answer))
            .catch(() => {})
        } else {
          hostSession.handleSignal(from, payload)
        }
      } else {
        const clientSession = session as ClientSession
        if (from === roomRef.current?.hostId) {
          clientSession.handleSignal(payload)
        }
      }
    })

    signaling.onPresence((event, participant, participants) => {
      dispatch({ type: 'SET_PARTICIPANTS', participants })

      if (roleRef.current === 'host' && stateRef.current.status === 'connected') {
        const hostSession = sessionRef.current as HostSession | null
        hostSession?.broadcastPresence(participants)
        const text =
          event === 'join'
            ? `${participant.nickname} подключился`
            : `${participant.nickname} отключился`
        hostSession?.broadcastSystem(text)
      }
    })

    signaling.onHostLeft(() => handleHostLeft())

    signaling.onError((code, message) => {
      const isJoinError =
        code === 'room_full' || code === 'room_not_found' || code === 'invalid_nickname'
      dispatch({ type: 'SET_ERROR', error: isJoinError ? mapJoinError(code) : message })
      dispatch({ type: 'SET_STATUS', status: 'closed' })
    })

    signaling.onClose(() => {
      if (!leftRef.current) {
        handleHostLeft()
      }
    })
  }

  const setNickname = (nickname: string): void => {
    dispatch({ type: 'SET_NICKNAME', nickname })
  }

  const createRoom = async (nickname: string): Promise<void> => {
    const validationError = validateNickname(nickname)
    if (validationError) {
      dispatch({ type: 'SET_ERROR', error: validationError })
      return
    }

    leftRef.current = false
    dispatch({ type: 'CONNECTING', nickname })

    try {
      const room = await SignalingClient.createRoom(nickname)
      nicknameRef.current = nickname
      roomRef.current = room
      roleRef.current = 'host'
      dispatch({
        type: 'SET_ROOM',
        room,
        role: 'host',
        participants: [{ id: room.participantId, nickname }],
      })

      const signaling = new SignalingClient()
      signalingRef.current = signaling
      attachCallbacks(signaling)
      await signaling.connect(room)
    } catch (e) {
      const signaling = signalingRef.current
      signalingRef.current = null
      signaling?.close()
      handleJoinError(e)
    }
  }

  const joinRoom = async (code: string, nickname: string): Promise<void> => {
    const validationError = validateNickname(nickname)
    if (validationError) {
      dispatch({ type: 'SET_ERROR', error: validationError })
      return
    }

    leftRef.current = false
    dispatch({ type: 'CONNECTING', nickname })

    try {
      const room = await SignalingClient.joinRoom(code, nickname)
      nicknameRef.current = nickname
      roomRef.current = room
      roleRef.current = 'client'
      dispatch({ type: 'SET_ROOM', room, role: 'client', participants: [] })

      const signaling = new SignalingClient()
      signalingRef.current = signaling
      attachCallbacks(signaling)
      await signaling.connect(room)
    } catch (e) {
      const signaling = signalingRef.current
      signalingRef.current = null
      signaling?.close()
      handleJoinError(e)
    }
  }

  const sendMessage = (text: string): void => {
    if (stateRef.current.status !== 'connected') return

    const validationError = validateMessage(text)
    if (validationError) {
      dispatch({ type: 'SET_ERROR', error: validationError })
      return
    }

    const session = sessionRef.current
    if (!session) return

    if (roleRef.current === 'host') {
      ;(session as HostSession).sendChat(text)
    } else {
      ;(session as ClientSession).send(text, (Date.now() / 1000) | 0)
    }
  }

  const leave = (): void => {
    leftRef.current = true
    const signaling = signalingRef.current
    const session = sessionRef.current
    signalingRef.current = null
    sessionRef.current = null
    roomRef.current = null
    roleRef.current = null
    nicknameRef.current = ''
    session?.close()
    signaling?.close()
    dispatch({ type: 'RESET' })
  }

  const actions: ChatActions = {
    setNickname,
    createRoom,
    joinRoom,
    sendMessage,
    leave,
  }

  return <ChatContext.Provider value={{ state, actions }}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChat must be used within ChatProvider')
  }
  return context
}

export default ChatProvider
