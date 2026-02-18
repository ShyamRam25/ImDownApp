import { useState } from 'react'
import Calendar from './components/Calendar'
import Login from './components/Login'
import './App.css'

const STORAGE_KEY = 'imdown_user'

function App() {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed?.id && parsed?.username) {
          return parsed
        }
      }
    } catch {
      // ignore invalid stored data
    }
    return null
  })

  const handleLogin = (userData) => {
    setUser(userData)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userData))
  }

  const handleLogout = () => {
    setUser(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  if (!user) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      <div className="container mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800">ImDown</h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-700">
              Welcome, <strong>{user.username}</strong>!
            </span>
            <button
              onClick={handleLogout}
              className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
        <Calendar user={user} />
      </div>
    </div>
  )
}

export default App
