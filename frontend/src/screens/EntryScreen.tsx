import { useState } from 'react'
import { useChat } from '../store/chatStore'
import { MAX_NICKNAME_LENGTH } from '../constants'

function EntryScreen() {
  const { state, actions } = useChat()
  const [code, setCode] = useState('')

  const connecting = state.status === 'connecting'
  const nickname = state.nickname
  const canJoin = code.trim().length > 0 && !connecting

  return (
    <div className="entry">
      <div className="entry-card">
        <h1 className="entry-title">Приватный чат</h1>
        <p className="entry-subtitle">Комнаты на WebRTC — без серверов сообщений</p>

        <label className="field">
          <span className="field-label">Ваш ник</span>
          <input
            className="field-input"
            type="text"
            value={nickname}
            maxLength={MAX_NICKNAME_LENGTH}
            placeholder="Как вас зовут?"
            disabled={connecting}
            onChange={(e) => actions.setNickname(e.target.value)}
          />
        </label>

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={connecting}
          onClick={() => actions.createRoom(nickname)}
        >
          Создать
        </button>

        <div className="entry-divider">
          <span>или</span>
        </div>

        <div className="entry-join">
          <input
            className="field-input"
            type="text"
            value={code}
            placeholder="Код комнаты"
            disabled={connecting}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canJoin}
            onClick={() => actions.joinRoom(code, nickname)}
          >
            Войти
          </button>
        </div>

        {state.error && <p className="entry-error">{state.error}</p>}
      </div>
    </div>
  )
}

export default EntryScreen
