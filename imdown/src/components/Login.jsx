import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

function decodeJwtPayload(token) {
  const base64Url = token.split('.')[1]
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const json = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  )
  return JSON.parse(json)
}

function Login({ onLogin }) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const googleBtnRef = useRef(null)

  const handleGoogleCredential = async (response) => {
    setLoading(true)
    setMessage({ type: '', text: '' })

    try {
      const payload = decodeJwtPayload(response.credential)
      const googleId = payload.sub
      const email = payload.email
      const name = payload.name || email.split('@')[0]
      const avatarUrl = payload.picture || ''

      const { data: existing, error: fetchErr } = await supabase
        .from('users')
        .select('id, username')
        .eq('google_id', googleId)
        .maybeSingle()

      if (fetchErr) throw fetchErr

      if (existing) {
        onLogin({ id: existing.id, username: existing.username })
        return
      }

      let chosenUsername = name.replace(/\s+/g, '_').toLowerCase()
      const { data: nameTaken } = await supabase
        .from('users')
        .select('id')
        .eq('username', chosenUsername)
        .maybeSingle()

      if (nameTaken) {
        chosenUsername = `${chosenUsername}_${Date.now().toString(36)}`
      }

      const { data: newUser, error: insertErr } = await supabase
        .from('users')
        .insert({
          username: chosenUsername,
          google_id: googleId,
          email,
          avatar_url: avatarUrl,
          password: null,
        })
        .select('id, username')
        .single()

      if (insertErr) throw insertErr

      onLogin({ id: newUser.id, username: newUser.username })
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Google sign-in failed' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleBtnRef.current) return

    const interval = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(interval)
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredential,
        })
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline',
          size: 'large',
          width: '100%',
          text: 'signin_with',
        })
      }
    }, 200)

    return () => clearInterval(interval)
  }, [])

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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-8 px-4">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <h2 className="text-3xl font-bold text-center text-gray-800 mb-6">
          {isSignUp ? 'Create Account' : 'Sign In'}
        </h2>

        {/* Google Sign-In */}
        {GOOGLE_CLIENT_ID && (
          <>
            <div ref={googleBtnRef} className="flex justify-center mb-4" />
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-3 text-gray-500">or</span>
              </div>
            </div>
          </>
        )}

        {/* Username / password form */}
        <form onSubmit={isSignUp ? handleSignUp : handleSignIn} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder={isSignUp ? 'Choose a username' : 'Your username'}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          {message.text && (
            <div
              className={`p-3 rounded-lg ${
                message.type === 'error'
                  ? 'bg-red-50 text-red-700'
                  : message.type === 'success'
                  ? 'bg-green-50 text-green-700'
                  : 'bg-yellow-50 text-yellow-700'
              }`}
            >
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
            className="text-indigo-600 hover:text-indigo-700 font-medium"
          >
            {isSignUp
              ? 'Already have an account? Sign in'
              : "Don't have an account? Sign up"}
          </button>
        </div>
      </div>
    </div>
  )
}

export default Login
