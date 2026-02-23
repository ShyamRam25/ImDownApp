import { useState } from 'react'
import Calendar from './components/Calendar'
import Login from './components/Login'
import './App.css'

const STORAGE_KEY = 'imdown_user'

function Logo({ className = '' }) {
  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Icon mark */}
      <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center shadow-md shadow-pine-900/20">
        <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none">
          <path
            d="M7 10l5 5 5-5"
            stroke="#22c55e"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 4v11"
            stroke="#22c55e"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M5 18h14"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {/* Wordmark */}
      <span className="text-3xl font-bold tracking-tight">
        <span className="text-black">Im</span>
        <span className="text-pine-800">Down</span>
      </span>
    </div>
  )
}

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
    <div className="min-h-screen bg-gradient-to-br from-pine-50 via-white to-pine-50 py-8 px-4">
      <div className="container mx-auto max-w-5xl">
        <div className="flex justify-between items-center mb-8">
          <Logo />
          <div className="flex items-center gap-4">
            <span className="text-gray-600 text-sm">
              Welcome, <strong className="text-gray-900">{user.username}</strong>
            </span>
            <button
              onClick={handleLogout}
              className="bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-black transition-colors text-sm font-medium"
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
