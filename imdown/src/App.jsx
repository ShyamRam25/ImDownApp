import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Calendar from './components/Calendar'
import Login from './components/Login'
import GroupManager from './components/GroupManager'
import GroupInvitations from './components/GroupInvitations'
import GoogleCalendarImport from './components/GoogleCalendarImport'
import './App.css'

const STORAGE_KEY = 'imdown_user'
const SELECTED_GROUP_KEY = 'imdown_selected_group'

function App() {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed?.id && parsed?.username) return parsed
      }
    } catch { /* ignore */ }
    return null
  })

  const [groups, setGroups] = useState([])
  const [selectedGroupId, setSelectedGroupId] = useState(() =>
    localStorage.getItem(SELECTED_GROUP_KEY) || 'all'
  )
  const [showGroupManager, setShowGroupManager] = useState(false)
  const [showGcalImport, setShowGcalImport] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [groupsLoading, setGroupsLoading] = useState(false)

  const fetchGroups = async () => {
    if (!user?.id) return
    setGroupsLoading(true)
    try {
      const { data, error } = await supabase
        .from('group_members')
        .select('role, color, groups(id, name)')
        .eq('user_id', user.id)

      if (error) throw error

      const userGroups = (data || [])
        .map((row) => (row.groups ? { ...row.groups, role: row.role, color: row.color } : null))
        .filter(Boolean)
      setGroups(userGroups)

      if (
        selectedGroupId !== 'all' &&
        selectedGroupId !== 'personal' &&
        !userGroups.some((g) => g.id === selectedGroupId)
      ) {
        setSelectedGroupId('all')
        localStorage.setItem(SELECTED_GROUP_KEY, 'all')
      }
    } catch (err) {
      console.error('Failed to fetch groups:', err.message)
    } finally {
      setGroupsLoading(false)
    }
  }

  useEffect(() => {
    fetchGroups()
  }, [user?.id])

  const handleLogin = (userData) => {
    setUser(userData)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userData))
  }

  const handleLogout = () => {
    setUser(null)
    setGroups([])
    setSelectedGroupId('all')
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(SELECTED_GROUP_KEY)
  }

  const handleGroupChange = (groupId) => {
    setSelectedGroupId(groupId)
    localStorage.setItem(SELECTED_GROUP_KEY, groupId)
  }

  if (!user) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <div className="min-h-screen bg-dark py-6 px-4">
      <div className="container mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 flex-wrap gap-4 bg-dark-50 border border-dark-200 rounded-2xl px-6 py-4">
          <img
            src="/images/LogoPhoto.png"
            alt="ImDown"
            className="h-14 w-auto rounded-xl"
          />

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label htmlFor="group-select" className="text-sm font-medium text-gray-400 tracking-tight">
                Group:
              </label>
              <select
                id="group-select"
                value={selectedGroupId}
                onChange={(e) => handleGroupChange(e.target.value)}
                disabled={groupsLoading}
                className="input-field py-2 px-3 text-sm font-medium w-auto"
              >
                <option value="all">All Groups</option>
                <option value="personal">Personal</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setShowGroupManager(true)}
              className="btn-secondary text-sm"
            >
              Manage Groups
            </button>

            <button
              onClick={() => setShowGcalImport(true)}
              className="btn-secondary text-sm"
            >
              Import Google Cal
            </button>

            <span className="text-gray-400 tracking-tight">
              Welcome, <strong className="text-neon-200">{user.username}</strong>!
            </span>
            <button
              onClick={handleLogout}
              className="btn-danger text-sm"
            >
              Logout
            </button>
          </div>
        </div>

        <GroupInvitations user={user} onInvitationsChanged={fetchGroups} />

        <Calendar
          user={user}
          groups={groups}
          selectedGroupId={selectedGroupId}
          refreshKey={refreshKey}
        />

        {showGroupManager && (
          <GroupManager
            user={user}
            groups={groups}
            onClose={() => setShowGroupManager(false)}
            onGroupsChanged={fetchGroups}
          />
        )}

        {showGcalImport && (
          <GoogleCalendarImport
            user={user}
            groups={groups}
            onClose={() => setShowGcalImport(false)}
            onImported={() => setRefreshKey((k) => k + 1)}
          />
        )}
      </div>
    </div>
  )
}

export default App
