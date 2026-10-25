import { describe, expect, it } from 'vitest'
import { mapJoinError, validateMessage, validateNickname } from './validation'

describe('validateNickname', () => {
  it('returns null for a valid nickname', () => {
    expect(validateNickname('Alice')).toBeNull()
  })

  it('returns null for a nickname with surrounding whitespace that is still valid', () => {
    expect(validateNickname('  Alice  ')).toBeNull()
  })

  it('returns null for an exactly 20 character nickname', () => {
    expect(validateNickname('a'.repeat(20))).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(validateNickname('')).not.toBeNull()
  })

  it('rejects a whitespace-only nickname', () => {
    expect(validateNickname('   ')).not.toBeNull()
  })

  it('rejects a nickname longer than 20 characters', () => {
    expect(validateNickname('a'.repeat(21))).not.toBeNull()
  })

  it('rejects a nickname that is valid before trimming but empty after trimming', () => {
    expect(validateNickname('     ')).not.toBeNull()
  })
})

describe('validateMessage', () => {
  it('returns null for a non-empty message within the limit', () => {
    expect(validateMessage('hello')).toBeNull()
  })

  it('returns null for a message of exactly 2000 characters', () => {
    expect(validateMessage('a'.repeat(2000))).toBeNull()
  })

  it('rejects an empty message', () => {
    expect(validateMessage('')).not.toBeNull()
  })

  it('rejects a message longer than 2000 characters', () => {
    expect(validateMessage('a'.repeat(2001))).not.toBeNull()
  })
})

describe('mapJoinError', () => {
  it('maps room_not_found to the Russian string', () => {
    expect(mapJoinError('room_not_found')).toBe('Комната не существует или хост офлайн')
  })

  it('maps room_full to the Russian string', () => {
    expect(mapJoinError('room_full')).toBe('Комната заполнена (макс. 20)')
  })

  it('maps invalid_nickname to the Russian string', () => {
    expect(mapJoinError('invalid_nickname')).toBe('Никнейм обязателен (до 20 символов)')
  })

  it('falls back to a generic message for unknown codes', () => {
    expect(mapJoinError('something_else')).toBe('Что-то пошло не так. Попробуйте ещё раз.')
  })
})
