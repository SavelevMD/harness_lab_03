import ChatProvider, { useChat } from './store/chatStore'
import EntryScreen from './screens/EntryScreen'
import ChatScreen from './screens/ChatScreen'
import './App.css'

function Router() {
  const { state } = useChat()
  return state.screen === 'entry' ? <EntryScreen /> : <ChatScreen />
}

function App() {
  return (
    <ChatProvider>
      <Router />
    </ChatProvider>
  )
}

export default App
