import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

const VIEW_STORAGE_KEY = 'imdown_calendar_view';

const pad2 = (n) => String(n).padStart(2, '0');

const ymdLocal = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const hmLocal = (date) => {
  const d = new Date(date);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const Calendar = ({ user, groups, selectedGroupId, refreshKey }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [view, setView] = useState(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === 'week' || stored === 'day' || stored === 'month' ? stored : 'month';
  });

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftLocation, setDraftLocation] = useState('');
  const [draftDate, setDraftDate] = useState(() => ymdLocal(new Date()));
  const [draftStart, setDraftStart] = useState('12:00');
  const [draftEnd, setDraftEnd] = useState('13:00');
  const [draftDetails, setDraftDetails] = useState('');
  const [draftGroups, setDraftGroups] = useState([]);
  const [eventError, setEventError] = useState('');
  const [viewingEvent, setViewingEvent] = useState(null);
  const [saving, setSaving] = useState(false);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const addDays = (date, amount) => {
    const d = new Date(date);
    d.setDate(d.getDate() + amount);
    return d;
  };

  const minutesIntoDay = (date) => {
    const d = new Date(date);
    return d.getHours() * 60 + d.getMinutes();
  };

  const parseLocalDateTime = (ymd, hm) => {
    const [y, m, d] = ymd.split('-').map(Number);
    const [hh, mm] = hm.split(':').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
  };

  const startOfWeek = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  };

  const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // ── Fetch events from Supabase ──────────────────────────────────────

  const fetchEvents = useCallback(async () => {
    if (!user?.id) return;

    const groupIds =
      selectedGroupId === 'all'
        ? groups.map((g) => g.id)
        : [selectedGroupId];

    if (groupIds.length === 0) {
      setEvents([]);
      return;
    }

    setEventsLoading(true);
    try {
      const { data: links, error: linksErr } = await supabase
        .from('event_groups')
        .select('event_id')
        .in('group_id', groupIds);

      if (linksErr) throw linksErr;

      const eventIds = [...new Set((links || []).map((l) => l.event_id))];
      if (eventIds.length === 0) {
        setEvents([]);
        return;
      }

      const { data, error } = await supabase
        .from('events')
        .select('*, event_rsvps(user_id, status), event_groups(group_id)')
        .in('id', eventIds)
        .order('start_time', { ascending: true });

      if (error) throw error;
      setEvents(data || []);
    } catch (err) {
      console.error('Failed to fetch events:', err.message);
    } finally {
      setEventsLoading(false);
    }
  }, [user?.id, selectedGroupId, groups, refreshKey]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Keep the open event-detail modal in sync with the latest events data,
  // so RSVP updates (and any background refetch) always reflect on screen.
  useEffect(() => {
    if (!viewingEvent) return;
    const fresh = events.find((e) => e.id === viewingEvent.id);
    if (fresh && fresh !== viewingEvent) {
      setViewingEvent(fresh);
    }
  }, [events]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Event CRUD ──────────────────────────────────────────────────────

  const openCreateEvent = () => {
    const base = selectedDate ?? currentDate;
    setDraftTitle('');
    setDraftLocation('');
    setDraftDate(ymdLocal(base));
    setDraftStart('12:00');
    setDraftEnd('13:00');
    setDraftDetails('');
    setDraftGroups(groups.length > 0 ? [groups[0].id] : []);
    setEventError('');
    setEventModalOpen(true);
  };

  const createEvent = async () => {
    const title = draftTitle.trim();
    if (!title) { setEventError('Please enter a title.'); return; }
    if (draftGroups.length === 0) { setEventError('Select at least one group.'); return; }

    const start = parseLocalDateTime(draftDate, draftStart);
    const end = parseLocalDateTime(draftDate, draftEnd);
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) { setEventError('Invalid start time.'); return; }
    if (!(end instanceof Date) || Number.isNaN(end.getTime())) { setEventError('Invalid end time.'); return; }
    if (end <= start) { setEventError('End time must be after start time.'); return; }

    setSaving(true);
    setEventError('');
    try {
      const { data: event, error: evErr } = await supabase
        .from('events')
        .insert({
          created_by: user.id,
          title,
          location: draftLocation.trim(),
          details: draftDetails.trim(),
          start_time: start.toISOString(),
          end_time: end.toISOString(),
        })
        .select()
        .single();

      if (evErr) throw evErr;

      const { error: linkErr } = await supabase
        .from('event_groups')
        .insert(draftGroups.map((gid) => ({ event_id: event.id, group_id: gid })));

      if (linkErr) throw linkErr;

      setEventModalOpen(false);
      fetchEvents();
    } catch (err) {
      setEventError(err.message || 'Failed to create event.');
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async (eventId) => {
    try {
      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', eventId)
        .eq('created_by', user.id);

      if (error) throw error;
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch (err) {
      console.error('Failed to delete event:', err.message);
    }
  };

  const updateEventRsvp = async (eventId, status) => {
    const existing = events.find((e) => e.id === eventId);
    const currentRsvp = existing?.event_rsvps?.find((r) => r.user_id === user.id);
    const isSame = currentRsvp?.status === status;

    const applyRsvpChange = (rsvps = []) => {
      const without = rsvps.filter((r) => r.user_id !== user.id);
      if (isSame) return without;
      return [
        ...without,
        { user_id: user.id, status, responded_at: new Date().toISOString() },
      ];
    };

    setEvents((prev) =>
      prev.map((e) =>
        e.id === eventId ? { ...e, event_rsvps: applyRsvpChange(e.event_rsvps) } : e
      )
    );
    setViewingEvent((prev) =>
      prev && prev.id === eventId
        ? { ...prev, event_rsvps: applyRsvpChange(prev.event_rsvps) }
        : prev
    );

    try {
      if (isSame) {
        await supabase
          .from('event_rsvps')
          .delete()
          .eq('event_id', eventId)
          .eq('user_id', user.id);
      } else {
        await supabase
          .from('event_rsvps')
          .upsert(
            { event_id: eventId, user_id: user.id, status, responded_at: new Date().toISOString() },
            { onConflict: 'event_id,user_id' }
          );
      }
      fetchEvents();
    } catch (err) {
      console.error('Failed to update RSVP:', err.message);
      fetchEvents();
    }
  };

  const getUserRsvp = (ev) => {
    return ev?.event_rsvps?.find((r) => r.user_id === user.id)?.status ?? null;
  };

  const getRsvpCounts = (ev) => {
    const rsvps = ev?.event_rsvps || [];
    return {
      going: rsvps.filter((r) => r.status === 'going').length,
      maybe: rsvps.filter((r) => r.status === 'maybe').length,
      notgoing: rsvps.filter((r) => r.status === 'notgoing').length,
    };
  };

  const openEventDetail = (ev) => {
    const fresh = events.find((e) => e.id === ev.id) ?? ev;
    setViewingEvent(fresh);
  };

  // ── Calendar view helpers ───────────────────────────────────────────

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) days.push(null);
    for (let day = 1; day <= daysInMonth; day++) days.push(new Date(year, month, day));
    return days;
  };

  const goToPrevious = () => {
    if (view === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
      return;
    }
    const delta = view === 'week' ? -7 : -1;
    setCurrentDate((prev) => addDays(prev, delta));
    setSelectedDate((prev) => (prev ? addDays(prev, delta) : prev));
  };

  const goToNext = () => {
    if (view === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
      return;
    }
    const delta = view === 'week' ? 7 : 1;
    setCurrentDate((prev) => addDays(prev, delta));
    setSelectedDate((prev) => (prev ? addDays(prev, delta) : prev));
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  };

  const handleDateClick = (date) => {
    if (date) { setSelectedDate(date); setCurrentDate(date); }
  };

  const handleViewChange = (nextView) => {
    setView(nextView);
    localStorage.setItem(VIEW_STORAGE_KEY, nextView);
    if ((nextView === 'week' || nextView === 'day') && !selectedDate) {
      setSelectedDate(currentDate);
    }
  };

  // ── Derived data ────────────────────────────────────────────────────

  const visibleStart = useMemo(() => {
    if (view === 'month') return new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    if (view === 'week') return startOfWeek(currentDate);
    return startOfDay(selectedDate ?? currentDate);
  }, [view, currentDate, selectedDate]);

  const visibleEnd = useMemo(() => {
    if (view === 'month') return new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);
    if (view === 'week') return addDays(startOfWeek(currentDate), 7);
    return addDays(startOfDay(selectedDate ?? currentDate), 1);
  }, [view, currentDate, selectedDate]);

  const eventsInRange = useMemo(() => {
    const startMs = visibleStart.getTime();
    const endMs = visibleEnd.getTime();
    return events.filter((e) => {
      const s = new Date(e.start_time).getTime();
      const en = new Date(e.end_time).getTime();
      return en > startMs && s < endMs;
    });
  }, [events, visibleStart, visibleEnd]);

  const eventsForDay = (date) => {
    const dayStart = startOfDay(date).getTime();
    const dayEnd = addDays(startOfDay(date), 1).getTime();
    return eventsInRange
      .filter((e) => {
        const s = new Date(e.start_time).getTime();
        const en = new Date(e.end_time).getTime();
        return en > dayStart && s < dayEnd;
      })
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  };

  const isToday = (date) => {
    if (!date) return false;
    const today = new Date();
    return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  };

  const isSelected = (date) => {
    if (!date || !selectedDate) return false;
    return date.getDate() === selectedDate.getDate() && date.getMonth() === selectedDate.getMonth() && date.getFullYear() === selectedDate.getFullYear();
  };

  const isMine = (ev) => ev.created_by === user?.id;

  const days = getDaysInMonth(currentDate);
  const currentMonth = monthNames[currentDate.getMonth()];
  const currentYear = currentDate.getFullYear();
  const weekStart = startOfWeek(currentDate);
  const weekDates = Array.from({ length: 7 }, (_, idx) => addDays(weekStart, idx));
  const weekEnd = weekDates[6];

  const headerText = (() => {
    if (view === 'month') return `${currentMonth} ${currentYear}`;
    if (view === 'day') {
      const d = selectedDate ?? currentDate;
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    const startLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endLabel = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${startLabel} – ${endLabel}, ${weekEnd.getFullYear()}`;
  })();

  // ── Styling helpers for own vs others' events ───────────────────────

  const eventChipClass = (ev) =>
    isMine(ev)
      ? 'bg-blue-500 text-white hover:bg-blue-600'
      : 'bg-blue-200 text-blue-800 opacity-70 hover:opacity-90';

  const eventHeaderBg = (ev) => (isMine(ev) ? 'bg-blue-500' : 'bg-blue-300');

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <button
          onClick={goToPrevious}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label={view === 'month' ? 'Previous month' : view === 'week' ? 'Previous week' : 'Previous day'}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-gray-800">{headerText}</h2>
          <button onClick={goToToday} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium">
            Today
          </button>
          <button onClick={openCreateEvent} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium">
            + Event
          </button>
          <div className="inline-flex rounded-lg bg-gray-100 p-1">
            {['month', 'week', 'day'].map((v) => {
              const active = view === v;
              return (
                <button
                  key={v}
                  onClick={() => handleViewChange(v)}
                  className={[
                    'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                    active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900',
                  ].join(' ')}
                  aria-pressed={active}
                >
                  {v[0].toUpperCase() + v.slice(1)}
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={goToNext}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label={view === 'month' ? 'Next month' : view === 'week' ? 'Next week' : 'Next day'}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {eventsLoading && (
        <div className="text-center py-2 text-sm text-gray-400">Loading events...</div>
      )}

      {/* Day-name header row (month + week views) */}
      {view !== 'day' && (
        <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {dayNames.map((day) => (
            <div key={day} className="text-center text-sm font-semibold text-gray-600 py-2">{day}</div>
          ))}
        </div>
      )}

      {/* ── Month view ─────────────────────────────────────────────── */}
      {view === 'month' && (
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {days.map((date, index) => {
            if (!date) return <div key={`empty-${index}`} className="min-h-[96px]" />;
            const isCurrentDay = isToday(date);
            const isSelectedDay = isSelected(date);
            const dayEvents = eventsForDay(date);
            const MAX_VISIBLE = 3;
            const visibleEvents = dayEvents.slice(0, MAX_VISIBLE);
            const overflow = dayEvents.length - visibleEvents.length;
            return (
              <div
                key={date.toISOString()}
                role="button"
                tabIndex={0}
                onClick={() => handleDateClick(date)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleDateClick(date);
                  }
                }}
                className={[
                  'min-h-[96px] p-1.5 rounded-lg transition-colors cursor-pointer',
                  'flex flex-col gap-1 text-left',
                  isSelectedDay
                    ? 'bg-white ring-2 ring-blue-500 shadow-md'
                    : isCurrentDay
                    ? 'bg-blue-50 border-2 border-blue-400'
                    : 'bg-gray-50 hover:bg-gray-100',
                ].join(' ')}
              >
                <div className="flex justify-end">
                  <span
                    className={[
                      'inline-flex items-center justify-center h-6 min-w-[24px] px-1 rounded-full text-xs font-semibold',
                      isCurrentDay
                        ? 'bg-blue-500 text-white'
                        : isSelectedDay
                        ? 'text-blue-700'
                        : 'text-gray-700',
                    ].join(' ')}
                  >
                    {date.getDate()}
                  </span>
                </div>

                <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
                  {visibleEvents.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEventDetail(ev);
                      }}
                      title={`${ev.title} · ${hmLocal(ev.start_time)}–${hmLocal(ev.end_time)}`}
                      className={`w-full truncate text-left rounded px-1.5 py-0.5 text-[11px] leading-tight transition-colors ${eventChipClass(ev)}`}
                    >
                      <span className="opacity-90 mr-1">{hmLocal(ev.start_time)}</span>
                      <span className="font-semibold">{ev.title}</span>
                    </button>
                  ))}
                  {overflow > 0 && (
                    <div className="text-[11px] font-medium text-gray-500 px-1">
                      +{overflow} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Week view ──────────────────────────────────────────────── */}
      {view === 'week' && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="grid" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
            <div className="bg-white border-b border-gray-200" />
            {weekDates.map((date) => {
              const isCurrentDay = isToday(date);
              const isSelectedDay = isSelected(date);
              return (
                <button
                  key={`weekhead-${date.toISOString()}`}
                  onClick={() => handleDateClick(date)}
                  className={[
                    'py-2 border-b border-gray-200 text-center transition-colors',
                    isSelectedDay ? 'bg-blue-50' : 'bg-white hover:bg-gray-50',
                  ].join(' ')}
                >
                  <div className="text-xs font-semibold text-gray-600">{dayNames[date.getDay()]}</div>
                  <div className={[
                    'mt-1 inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold',
                    isSelectedDay ? 'bg-blue-500 text-white' : isCurrentDay ? 'bg-blue-100 text-blue-700' : 'text-gray-800',
                  ].join(' ')}>
                    {date.getDate()}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="relative">
            <div className="grid" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={`hour-${hour}`} className="contents">
                  <div className="relative border-b border-gray-100 bg-white">
                    <div className="absolute -top-2 right-2 text-[10px] text-gray-400">
                      {hour === 0 ? '' : `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? 'AM' : 'PM'}`}
                    </div>
                    <div className="h-12" />
                  </div>
                  {weekDates.map((date) => (
                    <div key={`cell-${ymdLocal(date)}-${hour}`} className="border-b border-gray-100 border-l border-gray-100 bg-white h-12" />
                  ))}
                </div>
              ))}
            </div>

            <div className="absolute inset-0 grid pointer-events-none" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
              <div />
              {weekDates.map((date) => {
                const dayEvents = eventsForDay(date);
                const totalHeight = 24 * 48;
                return (
                  <div key={`events-${ymdLocal(date)}`} className="relative" style={{ height: totalHeight }}>
                    {dayEvents.map((ev) => {
                      const s = new Date(ev.start_time);
                      const e = new Date(ev.end_time);
                      const top = (minutesIntoDay(s) / 1440) * totalHeight;
                      const height = clamp(((e - s) / (1000 * 60) / 1440) * totalHeight, 18, totalHeight);
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => openEventDetail(ev)}
                          className={`absolute left-1 right-1 rounded-md text-xs px-2 py-1 shadow pointer-events-auto cursor-pointer overflow-hidden ${eventChipClass(ev)}`}
                          style={{ top, height }}
                          title={`${ev.title} · ${hmLocal(s)}–${hmLocal(e)}`}
                        >
                          <div className="font-semibold truncate">{ev.title}</div>
                          <div className="opacity-90 truncate">{hmLocal(s)}–{hmLocal(e)}</div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Day view ───────────────────────────────────────────────── */}
      {view === 'day' && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="grid" style={{ gridTemplateColumns: '64px 1fr' }}>
            <div className="bg-white border-b border-gray-200" />
            <div className="bg-white border-b border-gray-200 py-2 text-center">
              <div className="text-xs font-semibold text-gray-600">
                {(selectedDate ?? currentDate).toLocaleDateString('en-US', { weekday: 'long' })}
              </div>
              <div className="mt-1 text-sm font-bold text-gray-800">
                {(selectedDate ?? currentDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="grid" style={{ gridTemplateColumns: '64px 1fr' }}>
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={`day-hour-${hour}`} className="contents">
                  <div className="relative border-b border-gray-100 bg-white">
                    <div className="absolute -top-2 right-2 text-[10px] text-gray-400">
                      {hour === 0 ? '' : `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? 'AM' : 'PM'}`}
                    </div>
                    <div className="h-12" />
                  </div>
                  <div className="border-b border-gray-100 border-l border-gray-100 bg-white h-12" />
                </div>
              ))}
            </div>

            <div className="absolute inset-0 grid pointer-events-none" style={{ gridTemplateColumns: '64px 1fr' }}>
              <div />
              <div className="relative" style={{ height: 24 * 48 }}>
                {eventsForDay(selectedDate ?? currentDate).map((ev) => {
                  const s = new Date(ev.start_time);
                  const e = new Date(ev.end_time);
                  const totalHeight = 24 * 48;
                  const top = (minutesIntoDay(s) / 1440) * totalHeight;
                  const height = clamp(((e - s) / (1000 * 60) / 1440) * totalHeight, 18, totalHeight);
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => openEventDetail(ev)}
                      className={`absolute left-2 right-2 rounded-md text-xs px-2 py-1 shadow pointer-events-auto cursor-pointer overflow-hidden ${eventChipClass(ev)}`}
                      style={{ top, height }}
                      title={`${ev.title} · ${hmLocal(s)}–${hmLocal(e)}`}
                    >
                      <div className="font-semibold truncate">{ev.title}</div>
                      <div className="opacity-90 truncate">{hmLocal(s)}–{hmLocal(e)}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Selected Date Display */}
      {selectedDate && (
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">Selected Date:</p>
          <p className="text-lg font-semibold text-gray-800">
            {selectedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      )}

      {/* ── Create Event Modal ─────────────────────────────────────── */}
      {eventModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="w-full max-w-5xl bg-white rounded-xl shadow-2xl p-6 border border-gray-200 font-teams">
            <div className="flex items-start justify-between gap-4 mb-4">
              <h3 className="text-3xl font-bold text-gray-900">New Event</h3>
              <button
                type="button"
                onClick={() => setEventModalOpen(false)}
                className="px-3 py-1 border-2 border-gray-900 rounded-md hover:bg-black/5 text-gray-900 font-bold"
                aria-label="Close"
              >
                X
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left column */}
              <div className="space-y-4">
                <div>
                  <label className="block text-lg font-bold text-gray-900 mb-1">
                    Title <span className="text-red-600">*</span>
                  </label>
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-transparent border-2 border-gray-900 rounded-md text-lg focus:outline-none"
                    placeholder="Pickleball 3v3"
                  />
                </div>

                <div>
                  <label className="block text-lg font-bold text-gray-900 mb-1">Location</label>
                  <input
                    value={draftLocation}
                    onChange={(e) => setDraftLocation(e.target.value)}
                    className="w-full px-3 py-2 bg-transparent border-2 border-gray-900 rounded-md text-lg focus:outline-none"
                    placeholder="Anderson Park, College Station"
                  />
                </div>

                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-lg font-bold text-gray-900 mb-1">Start</label>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className="w-full px-3 py-2 bg-transparent border-2 border-gray-900 rounded-md focus:outline-none" />
                        <input type="time" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} className="w-full px-3 py-2 bg-transparent border-2 border-gray-900 rounded-md focus:outline-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-lg font-bold text-gray-900 mb-1">End</label>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className="w-full px-3 py-2 bg-transparent border-2 border-gray-900 rounded-md focus:outline-none" />
                        <input type="time" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} className="w-full px-3 py-2 bg-transparent border-2 border-gray-900 rounded-md focus:outline-none" />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-lg font-bold text-gray-900 mb-1">Details</label>
                  <div className="border-2 border-gray-900 rounded-md overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b-2 border-gray-900 bg-black/0">
                      <button type="button" className="px-2 py-0.5 border-2 border-gray-900 rounded-md font-bold">B</button>
                      <button type="button" className="px-2 py-0.5 border-2 border-gray-900 rounded-md italic">I</button>
                      <button type="button" className="px-2 py-0.5 border-2 border-gray-900 rounded-md underline">U</button>
                    </div>
                    <textarea
                      value={draftDetails}
                      onChange={(e) => setDraftDetails(e.target.value)}
                      rows={5}
                      className="w-full px-3 py-2 bg-transparent text-lg focus:outline-none resize-none"
                      placeholder="We can rotate by king of the court..."
                    />
                  </div>
                </div>
              </div>

              {/* Right column */}
              <div className="space-y-4">
                <div>
                  <div className="text-lg font-bold text-gray-900 mb-2">Which group do you want to invite</div>
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 max-h-56 overflow-y-auto pr-2 space-y-2">
                    {groups.length === 0 ? (
                      <p className="text-gray-500 text-sm">Join a group first to create events.</p>
                    ) : (
                      groups.map((g) => {
                        const checked = draftGroups.includes(g.id);
                        return (
                          <label key={g.id} className="flex items-center justify-between gap-3 cursor-pointer select-none">
                            <span className="text-lg">{g.name}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? Array.from(new Set([...draftGroups, g.id]))
                                  : draftGroups.filter((x) => x !== g.id);
                                setDraftGroups(next);
                              }}
                              className="h-5 w-5 accent-indigo-600"
                            />
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="pt-2">
                  <div className="text-lg font-bold text-gray-900">Organizer</div>
                  <div className="text-lg text-gray-900">{user?.username ?? 'Unknown'}</div>
                </div>

                {eventError && (
                  <div className="p-3 border-2 border-red-700 rounded-md bg-red-50 text-red-800 text-base">
                    {eventError}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEventModalOpen(false)}
                    className="px-5 py-2 border-2 border-gray-900 rounded-md hover:bg-black/5 text-gray-900 text-lg font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={createEvent}
                    disabled={saving}
                    className="px-5 py-2 border-2 border-gray-900 rounded-md bg-blue-200 hover:bg-blue-300 text-gray-900 text-lg font-bold disabled:opacity-50"
                  >
                    {saving ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Event Detail / RSVP Modal ──────────────────────────────── */}
      {viewingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={() => setViewingEvent(null)}>
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className={`px-6 py-4 ${eventHeaderBg(viewingEvent)}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-white leading-snug">{viewingEvent.title}</h3>
                  {!isMine(viewingEvent) && (
                    <span className="text-xs text-white/80">Someone else&apos;s event</span>
                  )}
                </div>
                <button type="button" onClick={() => setViewingEvent(null)} className="text-white/80 hover:text-white text-lg font-bold leading-none mt-0.5" aria-label="Close">
                  ✕
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Date & time */}
              <div className="flex items-start gap-3 text-gray-700">
                <svg className="w-5 h-5 mt-0.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <div className="font-medium">
                    {new Date(viewingEvent.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div className="text-sm text-gray-500">
                    {hmLocal(viewingEvent.start_time)} – {hmLocal(viewingEvent.end_time)}
                  </div>
                </div>
              </div>

              {/* Location */}
              {viewingEvent.location && (
                <div className="flex items-start gap-3 text-gray-700">
                  <svg className="w-5 h-5 mt-0.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>{viewingEvent.location}</span>
                </div>
              )}

              {/* Invited groups */}
              {viewingEvent.event_groups?.length > 0 && (
                <div className="flex items-start gap-3 text-gray-700">
                  <svg className="w-5 h-5 mt-0.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <span>
                    {viewingEvent.event_groups
                      .map((eg) => groups.find((g) => g.id === eg.group_id)?.name ?? 'Unknown group')
                      .join(', ')}
                  </span>
                </div>
              )}

              {/* Details */}
              {viewingEvent.details && (
                <div className="p-3 bg-gray-50 rounded-lg text-gray-700 text-sm whitespace-pre-wrap">
                  {viewingEvent.details}
                </div>
              )}

              {/* RSVP counts */}
              {(() => {
                const counts = getRsvpCounts(viewingEvent);
                const total = counts.going + counts.maybe + counts.notgoing;
                if (total === 0) return null;
                return (
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>{counts.going} going</span>
                    <span>{counts.maybe} maybe</span>
                    <span>{counts.notgoing} can&apos;t</span>
                  </div>
                );
              })()}

              {/* RSVP buttons */}
              <div>
                <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Are you down?</div>
                <div className="flex gap-2">
                  {[
                    { key: 'going', label: "I'm Down!", activeClass: 'bg-green-500 text-white border-green-500', icon: '🤙' },
                    { key: 'maybe', label: 'Maybe', activeClass: 'bg-yellow-400 text-gray-900 border-yellow-400', icon: '🤔' },
                    { key: 'notgoing', label: "Can't Make It", activeClass: 'bg-red-500 text-white border-red-500', icon: '😔' },
                  ].map(({ key, label, activeClass, icon }) => {
                    const isActive = getUserRsvp(viewingEvent) === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => updateEventRsvp(viewingEvent.id, key)}
                        className={[
                          'flex-1 py-2 px-2 rounded-lg border-2 text-sm font-semibold transition-all text-center',
                          isActive ? activeClass : 'border-gray-200 text-gray-600 hover:border-gray-400',
                        ].join(' ')}
                      >
                        <span className="block text-base">{icon}</span>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Delete (only for own events) */}
              {isMine(viewingEvent) && (
                <div className="flex justify-end pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => { deleteEvent(viewingEvent.id); setViewingEvent(null); }}
                    className="text-red-500 hover:text-red-700 text-sm font-medium transition-colors"
                  >
                    Delete Event
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Calendar;
