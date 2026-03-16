import { useState } from 'react';
import { supabase } from '../lib/supabase';
import useGoogleCalendar from '../hooks/useGoogleCalendar';

const GoogleCalendarImport = ({ user, groups, onClose, onImported }) => {
  const { ready, authorized, error: hookError, authorize, revokeAccess, fetchEvents } = useGoogleCalendar();

  const [step, setStep] = useState('connect'); // 'connect' | 'preview' | 'importing' | 'done'
  const [gcalEvents, setGcalEvents] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [targetGroups, setTargetGroups] = useState(groups.length > 0 ? [groups[0].id] : []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [importedCount, setImportedCount] = useState(0);

  const handleAuthorize = async () => {
    setLoading(true);
    setError('');
    try {
      await authorize();
      const events = await fetchEvents();
      setGcalEvents(events);
      setSelected(new Set(events.map((_, i) => i)));
      setStep('preview');
    } catch (err) {
      if (err.message === 'popup_closed_by_user') {
        setError('Authorization popup was closed. Please try again.');
      } else {
        setError(err.message || 'Failed to connect to Google Calendar.');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleEvent = (idx) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === gcalEvents.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(gcalEvents.map((_, i) => i)));
    }
  };

  const handleImport = async () => {
    if (selected.size === 0) { setError('Select at least one event.'); return; }
    if (targetGroups.length === 0) { setError('Select at least one group.'); return; }

    setStep('importing');
    setError('');
    let count = 0;

    try {
      const eventsToImport = gcalEvents.filter((_, i) => selected.has(i));

      for (const ev of eventsToImport) {
        const startTime = new Date(ev.start).toISOString();
        const endTime = new Date(ev.end).toISOString();

        if (new Date(endTime) <= new Date(startTime)) continue;

        const { data: event, error: evErr } = await supabase
          .from('events')
          .insert({
            created_by: user.id,
            title: ev.title,
            location: ev.location,
            details: ev.details,
            start_time: startTime,
            end_time: endTime,
          })
          .select()
          .single();

        if (evErr) {
          console.error('Failed to import event:', ev.title, evErr.message);
          continue;
        }

        await supabase
          .from('event_groups')
          .insert(targetGroups.map((gid) => ({ event_id: event.id, group_id: gid })));

        count++;
      }

      setImportedCount(count);
      setStep('done');
      onImported?.();
    } catch (err) {
      setError(err.message || 'Import failed.');
      setStep('preview');
    }
  };

  const handleDisconnect = () => {
    revokeAccess();
    setStep('connect');
    setGcalEvents([]);
    setSelected(new Set());
  };

  const formatDateTime = (isoStr) => {
    const d = new Date(isoStr);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.5 3h-3V1.5h-1.5V3h-6V1.5H7.5V3h-3C3.675 3 3 3.675 3 4.5v15c0 .825.675 1.5 1.5 1.5h15c.825 0 1.5-.675 1.5-1.5v-15c0-.825-.675-1.5-1.5-1.5zm0 16.5h-15V8.25h15v11.25z" />
            </svg>
            <h2 className="text-xl font-bold text-gray-900">Import from Google Calendar</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg font-bold">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {(error || hookError) && (
            <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
              {error || hookError}
            </div>
          )}

          {/* Step 1: Connect */}
          {step === 'connect' && (
            <div className="text-center py-8 space-y-4">
              <p className="text-gray-600">
                Connect your Google account to import events from your Google Calendar into ImDown.
              </p>
              <button
                onClick={handleAuthorize}
                disabled={!ready || loading}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white border-2 border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
              >
                {loading ? (
                  <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                )}
                {loading ? 'Connecting...' : 'Connect Google Calendar'}
              </button>
              {!ready && !hookError && (
                <p className="text-xs text-gray-400">Loading Google libraries...</p>
              )}
            </div>
          )}

          {/* Step 2: Preview & select events */}
          {step === 'preview' && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Found <strong>{gcalEvents.length}</strong> events. Select the ones you want to import.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleAll}
                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    {selected.size === gcalEvents.length ? 'Deselect All' : 'Select All'}
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Disconnect
                  </button>
                </div>
              </div>

              {gcalEvents.length === 0 ? (
                <p className="text-gray-500 text-center py-6">No events found in the selected date range.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {gcalEvents.map((ev, idx) => (
                    <label
                      key={ev.googleId || idx}
                      className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
                        selected.has(idx) ? 'bg-indigo-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(idx)}
                        onChange={() => toggleEvent(idx)}
                        className="mt-1 h-4 w-4 accent-indigo-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900 truncate">{ev.title}</div>
                        <div className="text-xs text-gray-500">
                          {formatDateTime(ev.start)} &ndash; {formatDateTime(ev.end)}
                        </div>
                        {ev.location && (
                          <div className="text-xs text-gray-400 truncate">{ev.location}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Target groups */}
              <div>
                <div className="text-sm font-bold text-gray-900 mb-2">Add to which group(s)?</div>
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 max-h-40 overflow-y-auto space-y-2">
                  {groups.length === 0 ? (
                    <p className="text-gray-500 text-sm">Join a group first to import events.</p>
                  ) : (
                    groups.map((g) => {
                      const checked = targetGroups.includes(g.id);
                      return (
                        <label key={g.id} className="flex items-center justify-between gap-3 cursor-pointer select-none">
                          <span className="text-sm">{g.name}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setTargetGroups((prev) =>
                                e.target.checked
                                  ? Array.from(new Set([...prev, g.id]))
                                  : prev.filter((x) => x !== g.id)
                              );
                            }}
                            className="h-4 w-4 accent-indigo-600"
                          />
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={selected.size === 0 || targetGroups.length === 0}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  Import {selected.size} Event{selected.size !== 1 ? 's' : ''}
                </button>
              </div>
            </>
          )}

          {/* Step 3: Importing */}
          {step === 'importing' && (
            <div className="text-center py-8 space-y-3">
              <span className="inline-block w-8 h-8 border-3 border-gray-300 border-t-indigo-600 rounded-full animate-spin" />
              <p className="text-gray-600">Importing events...</p>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 'done' && (
            <div className="text-center py-8 space-y-4">
              <div className="text-4xl">&#10003;</div>
              <p className="text-gray-800 font-medium">
                Successfully imported {importedCount} event{importedCount !== 1 ? 's' : ''}!
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GoogleCalendarImport;
