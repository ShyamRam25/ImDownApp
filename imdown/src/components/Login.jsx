import { useState } from 'react'
import { supabase } from '../lib/supabase'

function Login({ onLogin }) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })

  const handleSignUp = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage({ type: '', text: '' })

    try {
      const { error } = await supabase.from('users').insert([
        {
          username: username.trim(),
          password,
        },
      ])

      if (error) throw error

      setMessage({
        type: 'success',
        text: 'Account created! You can sign in now.',
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error.message || 'Failed to create account',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSignIn = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage({ type: '', text: '' })

    try {
      const { data: userRow, error: fetchError } = await supabase
        .from('users')
        .select('id, username, password')
        .eq('username', username.trim())
        .single()

      if (fetchError || !userRow) {
        throw new Error('Invalid username or password')
      }

      if (userRow.password !== password) {
        throw new Error('Invalid username or password')
      }

      onLogin({
        id: userRow.id,
        username: userRow.username,
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error.message || 'Failed to sign in',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pine-50 via-white to-pine-100 flex items-center justify-center py-8 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-black flex items-center justify-center shadow-lg shadow-pine-900/20 mb-4">
            <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none">
              <path d="M7 10l5 5 5-5" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 4v11" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M5 18h14" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <span className="text-4xl font-bold tracking-tight">
            <span className="text-black">Im</span>
            <span className="text-pine-800">Down</span>
          </span>
          <p className="text-gray-500 mt-2 text-sm">Plan things with your people</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-black/5 border border-gray-100 p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            {isSignUp ? 'Create Account' : 'Sign In'}
          </h2>

          <form onSubmit={isSignUp ? handleSignUp : handleSignIn} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-semibold text-gray-700 mb-1.5">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-pine-600/20 focus:border-pine-700 transition-colors outline-none"
                placeholder={isSignUp ? 'Choose a username' : 'Your username'}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-pine-600/20 focus:border-pine-700 transition-colors outline-none"
                placeholder="••••••••"
              />
            </div>

            {message.text && (
              <div
                className={`p-3 rounded-xl text-sm font-medium ${
                  message.type === 'error'
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : message.type === 'success'
                    ? 'bg-pine-50 text-pine-800 border border-pine-200'
                    : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                }`}
              >
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-pine-800 text-white py-2.5 px-4 rounded-xl font-semibold hover:bg-pine-900 focus:outline-none focus:ring-2 focus:ring-pine-700 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Loading...' : isSignUp ? 'Sign Up' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp)
                setMessage({ type: '', text: '' })
              }}
              className="text-pine-700 hover:text-pine-900 font-medium text-sm transition-colors"
            >
              {isSignUp
                ? 'Already have an account? Sign in'
                : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
