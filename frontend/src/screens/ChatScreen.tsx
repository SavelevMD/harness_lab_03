import { useEffect, useRef, useState } from 'react'
import { useChat } from '../store/chatStore'
import { MAX_MESSAGE_LENGTH, MAX_PARTICIPANTS } from '../constants'

function ChatScreen() {
  const { state, actions } = useChat()
  const [text, setText] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const feedRef = useRef<HTMLDivElement | null>(null)

  const room = state.room
  const code = room?.code ?? ''
  const hostId = state.role === 'host' ? (room?.participantId ?? '') : (room?.hostId ?? '')
  const closed = state.status === 'closed'

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.messages])

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    actions.sendMessage(trimmed)
    setText('')
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // clipboard may be unavailable; ignore
    }
  }

  return (
    <div className="chat">
      <header className="chat-header">
        <button
          type="button"
          className="btn btn-icon menu-toggle"
          aria-label="Участники"
          onClick={() => setPanelOpen((open) => !open)}
        >
          ☰
        </button>
        <span className="chat-code">Код: {code}</span>
        <span className="chat-count">
          {state.participants.length}/{MAX_PARTICIPANTS}
        </span>
        {state.role === 'host' && (
          <button type="button" className="btn btn-ghost" onClick={copyCode}>
            Копировать
          </button>
        )}
        <button type="button" className="btn btn-danger" onClick={actions.leave}>
          Покинуть
        </button>
      </header>

      <div className="chat-body">
        <aside className={`participants ${panelOpen ? 'open' : ''}`}>
          <h2 className="participants-title">Участники</h2>
          <ul className="participants-list">
            {state.participants.map((p) => (
              <li key={p.id} className="participant">
                {p.nickname}
                {p.id === hostId ? ' (хост)' : ''}
              </li>
            ))}
          </ul>
        </aside>

        {panelOpen && (
          <div
            className="backdrop"
            aria-hidden="true"
            onClick={() => setPanelOpen(false)}
          ></div>
        )}

        <main className="feed" ref={feedRef}>
          {state.messages.map((m) => {
            if (m.type === 'presence') return null
            if (m.type === 'system') {
              return (
                <div key={m.seq} className="msg msg-system">
                  {m.text}
                </div>
              )
            }
            const own = m.from === state.nickname
            return (
              <div key={m.seq} className={`msg ${own ? 'msg-own' : 'msg-other'}`}>
                {!own && <span className="msg-author">{m.from}</span>}
                <div className="bubble">{m.text}</div>
              </div>
            )
          })}
        </main>
      </div>

      <footer className="chat-input">
        <input
          className="field-input"
          type="text"
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Сообщение..."
          disabled={closed}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={closed || text.trim().length === 0}
          onClick={submit}
        >
          Отправить
        </button>
        {closed && <span className="chat-closed">Комната закрыта</span>}
      </footer>
    </div>
  )
}

export default ChatScreen
