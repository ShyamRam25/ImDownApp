import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const GROUP_COLOR_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#00E676',
];

function randomGroupColor() {
  return GROUP_COLOR_PALETTE[Math.floor(Math.random() * GROUP_COLOR_PALETTE.length)];
}

function GroupInvitations({ user, onInvitationsChanged }) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [error, setError] = useState('');

  const fetchInvites = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      setInvites([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data, error: qErr } = await supabase
        .from('group_invitations')
        .select(
          `
          id,
          group_id,
          created_at,
          groups ( id, name ),
          inviter:users!invited_by_user_id ( username )
        `
        )
        .eq('invited_user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (qErr) throw qErr;
      setInvites(data || []);
    } catch (err) {
      setError(err.message || 'Could not load invitations.');
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const channel = supabase
      .channel(`group_invitations:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_invitations',
          filter: `invited_user_id=eq.${user.id}`,
        },
        () => {
          fetchInvites();
        }
      )
      .subscribe();

    const onVis = () => {
      if (document.visibilityState === 'visible') fetchInvites();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(channel);
    };
  }, [user?.id, fetchInvites]);

  const handleAccept = async (row) => {
    setActingId(row.id);
    setError('');
    try {
      const { error: memErr } = await supabase.from('group_members').insert({
        group_id: row.group_id,
        user_id: user.id,
        role: 'member',
        color: randomGroupColor(),
      });

      const dup =
        memErr &&
        (memErr.code === '23505' ||
          String(memErr.message || '').toLowerCase().includes('duplicate'));

      if (memErr && !dup) throw memErr;

      const { error: updErr } = await supabase
        .from('group_invitations')
        .update({
          status: 'accepted',
          responded_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (updErr) throw updErr;

      setInvites((prev) => prev.filter((i) => i.id !== row.id));
      onInvitationsChanged?.();
    } catch (err) {
      setError(err.message || 'Could not accept invitation.');
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (row) => {
    setActingId(row.id);
    setError('');
    try {
      const { error: updErr } = await supabase
        .from('group_invitations')
        .update({
          status: 'rejected',
          responded_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (updErr) throw updErr;

      setInvites((prev) => prev.filter((i) => i.id !== row.id));
    } catch (err) {
      setError(err.message || 'Could not reject invitation.');
    } finally {
      setActingId(null);
    }
  };

  if (!user?.id) return null;
  if (loading) return null;
  if (invites.length === 0 && !error) return null;

  if (invites.length === 0 && error) {
    return (
      <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        Could not load invitations: {error}
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-neon/20 bg-neon/5 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-neon/20 bg-neon/10">
        <h2 className="text-sm font-semibold text-neon">Group invitations</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Someone invited you to join a group. Accept to add it to your groups, or decline.
        </p>
      </div>
      {error && (
        <div className="px-4 py-2 text-sm text-red-400 bg-red-500/10 border-b border-red-500/20">{error}</div>
      )}
      <ul className="divide-y divide-dark-300">
          {invites.map((row) => {
            const groupName = row.groups?.name ?? 'Unknown group';
            const inviterName = row.inviter?.username ?? 'Someone';
            const busy = actingId === row.id;
            return (
              <li key={row.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-200">
                    <span className="text-neon-200">{inviterName}</span>
                    {' '}
                    invited you to
                    {' '}
                    <span className="font-semibold text-gray-100">{groupName}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleReject(row)}
                    disabled={busy}
                    className="btn-secondary text-sm py-1.5 px-3"
                  >
                    {busy ? '…' : 'Decline'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAccept(row)}
                    disabled={busy}
                    className="btn-primary text-sm py-1.5 px-3"
                  >
                    {busy ? '…' : 'Accept'}
                  </button>
                </div>
              </li>
            );
          })}
      </ul>
    </div>
  );
}

export default GroupInvitations;
