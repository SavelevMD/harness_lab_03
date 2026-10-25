export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export const MAX_PARTICIPANTS = 20
export const MAX_MESSAGE_LENGTH = 2000
export const MAX_NICKNAME_LENGTH = 20

export const DATA_CHANNEL_LABEL = 'chat'

export const HOST_TIMEOUT_MS = 10000

export const SIGNALING_URL: string =
  (import.meta.env.VITE_SIGNALING_URL as string | undefined) ?? 'http://localhost:5080'

export const ERROR_MESSAGES = {
  room_not_found: 'Комната не существует или хост офлайн',
  room_full: 'Комната заполнена (макс. 20)',
  invalid_nickname: 'Никнейм обязателен (до 20 символов)',
  nat_failure: 'Не удалось подключиться. Попробуйте другую сеть.',
  host_left: 'Хост покинул чат. Комната закрыта.',
} as const

export type ErrorCode = keyof typeof ERROR_MESSAGES

export const GENERIC_ERROR_MESSAGE = 'Что-то пошло не так. Попробуйте ещё раз.'
