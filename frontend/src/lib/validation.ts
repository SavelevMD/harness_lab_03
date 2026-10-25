import {
  ERROR_MESSAGES,
  GENERIC_ERROR_MESSAGE,
  MAX_MESSAGE_LENGTH,
  MAX_NICKNAME_LENGTH,
} from '../constants'

const MESSAGE_REQUIRED = 'Сообщение не может быть пустым'
const MESSAGE_TOO_LONG = `Сообщение слишком длинное (макс. ${MAX_MESSAGE_LENGTH} символов)`

const JOIN_ERRORS: Record<string, string> = {
  room_not_found: ERROR_MESSAGES.room_not_found,
  room_full: ERROR_MESSAGES.room_full,
  invalid_nickname: ERROR_MESSAGES.invalid_nickname,
}

export function validateNickname(nickname: string): string | null {
  const trimmed = nickname.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_NICKNAME_LENGTH) {
    return ERROR_MESSAGES.invalid_nickname
  }
  return null
}

export function validateMessage(text: string): string | null {
  if (text.length === 0) {
    return MESSAGE_REQUIRED
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return MESSAGE_TOO_LONG
  }
  return null
}

export function mapJoinError(code: string): string {
  return JOIN_ERRORS[code] ?? GENERIC_ERROR_MESSAGE
}
