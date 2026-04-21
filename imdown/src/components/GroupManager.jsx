import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const GroupManager = ({ user, groups, onClose, onGroupsChanged }) => {
  const [tab, setTab] = useState('mine'); // 'mine' | 'create' | 'join' | 'invite'
  const [newGroupName, setNewGroupName] = useState('');
  const [joinSearch, setJoinSearch] = useState('');
  const [inviteGroupId, setInviteGroupId] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [availableGroups, setAvailableGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const myGroupIds = new Set(groups.map((g) => g.id));

  const searchGroups = async () => {
    if (!joinSearch.trim()) {
      setAvailableGroups([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('groups')
        .select('id, name')
        .ilike('name', `%${joinSearch.trim()}%`)
        .limit(20);

      if (error) throw error;
      setAvailableGroups((data || []).filter((g) => !myGroupIds.has(g.id)));
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(searchGroups, 300);
    return () => clearTimeout(timer);
  }, [joinSearch]);

  const handleCreate = async () => {
    const name = newGroupName.trim();
    if (!name) {
      setMessage({ type: 'error', text: 'Enter a group name.' });
      return;
    }
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      const { data: group, error: createErr } = await supabase
        .from('groups')
        .insert({ name, created_by: user.id })
        .select()
        .single();

      if (createErr) throw createErr;

      const { error: memberErr } = await supabase
        .from('group_members')
        .insert({ group_id: group.id, user_id: user.id, role: 'admin' });

      if (memberErr) throw memberErr;

      setNewGroupName('');
      setMessage({ type: 'success', text: `Created "${group.name}"!` });
      onGroupsChanged();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (groupId, groupName) => {
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      const { error } = await supabase
        .from('group_members')
        .insert({ group_id: groupId, user_id: user.id, role: 'member' });

      if (error) throw error;

      setAvailableGroups((prev) => prev.filter((g) => g.id !== groupId));
      setMessage({ type: 'success', text: `Joined "${groupName}"!` });
      onGroupsChanged();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (groups.length > 0 && !inviteGroupId) {
      setInviteGroupId(groups[0].id);
    }
    if (groups.length > 0 && inviteGroupId && !groups.some((g) => g.id === inviteGroupId)) {
      setInviteGroupId(groups[0].id);
    }
    if (groups.length === 0) {
      setInviteGroupId('');
    }
  }, [groups, inviteGroupId]);

  const handleSendInvite = async () => {
    const username = inviteUsername.trim();
    if (!username) {
      setMessage({ type: 'error', text: 'Enter a username to invite.' });
      return;
    }
    if (!inviteGroupId) {
      setMessage({ type: 'error', text: 'Choose a group first.' });
      return;
    }
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      const { data: invitee, error: userErr } = await supabase
        .from('users')
        .select('id, username')
        .eq('username', username)
        .maybeSingle();

      if (userErr) throw userErr;
      if (!invitee) {
        setMessage({ type: 'error', text: `No user found with username "${username}".` });
        return;
      }
      if (invitee.id === user.id) {
        setMessage({ type: 'error', text: 'You cannot invite yourself.' });
        return;
      }

      const { data: alreadyMember } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', inviteGroupId)
        .eq('user_id', invitee.id)
        .maybeSingle();

      if (alreadyMember) {
        setMessage({ type: 'error', text: 'That user is already in this group.' });
        return;
      }

      const { error: invErr } = await supabase.from('group_invitations').insert({
        group_id: inviteGroupId,
        invited_user_id: invitee.id,
        invited_by_user_id: user.id,
      });

      if (invErr) {
        if (invErr.code === '23505' || String(invErr.message || '').includes('idx_group_invitations_pending_unique')) {
          setMessage({ type: 'error', text: 'An invitation is already pending for this user and group.' });
          return;
        }
        throw invErr;
      }

      setInviteUsername('');
      setMessage({ type: 'success', text: `Invitation sent to ${invitee.username}!` });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async (groupId, groupName) => {
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('user_id', user.id);

      if (error) throw error;

      setMessage({ type: 'success', text: `Left "${groupName}".` });
      onGroupsChanged();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { key: 'mine', label: 'My Groups' },
    { key: 'create', label: 'Create' },
    { key: 'join', label: 'Join' },
    { key: 'invite', label: 'Invite' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Groups</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg font-bold">
            ✕
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setMessage({ type: '', text: '' }); }}
              className={[
                'flex-1 py-3 text-sm font-medium text-center transition-colors',
                tab === t.key
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 space-y-4 max-h-96 overflow-y-auto">
          {message.text && (
            <div className={`p-3 rounded-lg text-sm ${
              message.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
            }`}>
              {message.text}
            </div>
          )}

          {/* My Groups tab */}
          {tab === 'mine' && (
            groups.length === 0 ? (
              <p className="text-gray-500 text-center py-4">You haven&apos;t joined any groups yet.</p>
            ) : (
              <ul className="space-y-2">
                {groups.map((g) => (
                  <li key={g.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="font-medium text-gray-800">{g.name}</span>
                    <button
                      onClick={() => handleLeave(g.id, g.name)}
                      disabled={loading}
                      className="text-sm text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                    >
                      Leave
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          {/* Create tab */}
          {tab === 'create' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
                <input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="e.g. Friday Frisbee Crew"
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={loading || !newGroupName.trim()}
                className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Creating...' : 'Create Group'}
              </button>
            </div>
          )}

          {/* Join tab */}
          {tab === 'join' && (
            <div className="space-y-3">
              <input
                value={joinSearch}
                onChange={(e) => setJoinSearch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Search groups by name..."
              />
              {availableGroups.length === 0 && joinSearch.trim() && !loading && (
                <p className="text-gray-500 text-center text-sm py-2">No groups found.</p>
              )}
              <ul className="space-y-2">
                {availableGroups.map((g) => (
                  <li key={g.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="font-medium text-gray-800">{g.name}</span>
                    <button
                      onClick={() => handleJoin(g.id, g.name)}
                      disabled={loading}
                      className="text-sm px-3 py-1 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      Join
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Invite tab */}
          {tab === 'invite' && (
            groups.length === 0 ? (
              <p className="text-gray-500 text-center py-4">Join or create a group first, then you can invite others by username.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Group</label>
                  <select
                    value={inviteGroupId}
                    onChange={(e) => setInviteGroupId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                  <input
                    value={inviteUsername}
                    onChange={(e) => setInviteUsername(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendInvite()}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="Exact username (case-sensitive)"
                  />
                </div>
                <button
                  onClick={handleSendInvite}
                  disabled={loading || !inviteUsername.trim()}
                  className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Sending…' : 'Send invitation'}
                </button>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default GroupManager;
