import { useMemo, useState } from 'react';

const EVENT_STORAGE_PREFIX = 'imdown_events_';
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

const Calendar = ({ user }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [view, setView] = useState(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === 'week' || stored === 'day' || stored === 'month' ? stored : 'month';
  }); // 'month' | 'week' | 'day'

  const [events, setEvents] = useState(() => {
    if (!user?.id) return [];
    try {
      const raw = localStorage.getItem(`${EVENT_STORAGE_PREFIX}${user.id}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftLocation, setDraftLocation] = useState('');
  const [draftDate, setDraftDate] = useState(() => ymdLocal(new Date()));
  const [draftStart, setDraftStart] = useState('12:00');
  const [draftEnd, setDraftEnd] = useState('13:00');
  const [draftDetails, setDraftDetails] = useState('');
  const [draftGroups, setDraftGroups] = useState(['CSCW classmates']);
  const [eventError, setEventError] = useState('');
  const [viewingEvent, setViewingEvent] = useState(null);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const groupOptions = ['CSCW classmates', 'soccer teammates', 'capstone group', 'home town friends'];

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
    // ymd: YYYY-MM-DD, hm: HH:mm (local)
    const [y, m, d] = ymd.split('-').map(Number);
    const [hh, mm] = hm.split(':').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
  };

  const persistEvents = (nextEvents) => {
    if (!user?.id) return;
    try {
      localStorage.setItem(`${EVENT_STORAGE_PREFIX}${user.id}`, JSON.stringify(nextEvents));
    } catch {
      // ignore storage failures
    }
  };

  const startOfWeek = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay()); // Sunday-start week
    return d;
  };

  const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add all days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    
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
    if (date) {
      setSelectedDate(date);
      setCurrentDate(date);
    }
  };

  const handleViewChange = (nextView) => {
    setView(nextView);
    localStorage.setItem(VIEW_STORAGE_KEY, nextView);
    if ((nextView === 'week' || nextView === 'day') && !selectedDate) {
      setSelectedDate(currentDate);
    }
  };

  const openCreateEvent = () => {
    const base = selectedDate ?? currentDate;
    setDraftTitle('');
    setDraftLocation('');
    setDraftDate(ymdLocal(base));
    setDraftStart('12:00');
    setDraftEnd('13:00');
    setDraftDetails('');
    setDraftGroups(['CSCW classmates']);
    setEventError('');
    setEventModalOpen(true);
  };

  const createEvent = () => {
    const title = draftTitle.trim();
    if (!title) {
      setEventError('Please enter a title.');
      return;
    }

    const start = parseLocalDateTime(draftDate, draftStart);
    const end = parseLocalDateTime(draftDate, draftEnd);
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
      setEventError('Invalid start time.');
      return;
    }
    if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
      setEventError('Invalid end time.');
      return;
    }
    if (end <= start) {
      setEventError('End time must be after start time.');
      return;
    }

    const newEvent = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      userId: user?.id ?? null,
      title,
      location: draftLocation.trim(),
      details: draftDetails.trim(),
      inviteGroups: draftGroups,
      start: start.toISOString(),
      end: end.toISOString(),
      color: 'blue',
    };

    const nextEvents = [...events, newEvent].sort((a, b) => new Date(a.start) - new Date(b.start));
    setEvents(nextEvents);
    persistEvents(nextEvents);
    setEventModalOpen(false);
    setEventError('');
  };

  const deleteEvent = (eventId) => {
    const nextEvents = events.filter((e) => e.id !== eventId);
    setEvents(nextEvents);
    persistEvents(nextEvents);
  };

  const updateEventRsvp = (eventId, status) => {
    const nextEvents = events.map((e) =>
      e.id === eventId ? { ...e, rsvp: e.rsvp === status ? null : status } : e
    );
    setEvents(nextEvents);
    persistEvents(nextEvents);
    setViewingEvent((prev) =>
      prev?.id === eventId ? { ...prev, rsvp: prev.rsvp === status ? null : status } : prev
    );
  };

  const openEventDetail = (ev) => {
    const fresh = events.find((e) => e.id === ev.id) ?? ev;
    setViewingEvent(fresh);
  };

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
      const s = new Date(e.start).getTime();
      const en = new Date(e.end).getTime();
      return en > startMs && s < endMs;
    });
  }, [events, visibleStart, visibleEnd]);

  const eventsForDay = (date) => {
    const dayStart = startOfDay(date).getTime();
    const dayEnd = addDays(startOfDay(date), 1).getTime();
    return eventsInRange
      .filter((e) => {
        const s = new Date(e.start).getTime();
        const en = new Date(e.end).getTime();
        return en > dayStart && s < dayEnd;
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  };

  const isToday = (date) => {
    if (!date) return false;
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const isSelected = (date) => {
    if (!date || !selectedDate) return false;
    return (
      date.getDate() === selectedDate.getDate() &&
      date.getMonth() === selectedDate.getMonth() &&
      date.getFullYear() === selectedDate.getFullYear()
    );
  };

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
    const yearLabel = weekEnd.getFullYear();
    return `${startLabel} – ${endLabel}, ${yearLabel}`;
  })();

  return (
    <div className="w-full max-w-5xl mx-auto p-6 bg-white rounded-2xl shadow-xl shadow-black/5 border border-gray-100">
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <button
          onClick={goToPrevious}
          className="p-2 hover:bg-pine-50 rounded-xl transition-colors text-gray-700 hover:text-pine-800"
          aria-label={view === 'month' ? 'Previous month' : view === 'week' ? 'Previous week' : 'Previous day'}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
            {headerText}
          </h2>
          <button
            onClick={goToToday}
            className="px-4 py-2 bg-pine-800 text-white rounded-xl hover:bg-pine-900 transition-colors text-sm font-semibold shadow-sm"
          >
            Today
          </button>
          <button
            onClick={openCreateEvent}
            className="px-4 py-2 bg-black text-white rounded-xl hover:bg-gray-800 transition-colors text-sm font-semibold shadow-sm"
          >
            + Event
          </button>

          <div className="inline-flex rounded-xl bg-pine-50 p-1 border border-pine-100">
            {['month', 'week', 'day'].map((v) => {
              const active = view === v;
              return (
                <button
                  key={v}
                  onClick={() => handleViewChange(v)}
                  className={[
                    'px-3 py-1.5 text-sm font-semibold rounded-lg transition-all',
                    active ? 'bg-white text-pine-900 shadow-sm' : 'text-pine-700/70 hover:text-pine-900'
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
          className="p-2 hover:bg-pine-50 rounded-xl transition-colors text-gray-700 hover:text-pine-800"
          aria-label={view === 'month' ? 'Next month' : view === 'week' ? 'Next week' : 'Next day'}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {view !== 'day' && (
        <div
          className="grid gap-1 mb-1"
          style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
        >
          {dayNames.map((day) => (
            <div
              key={day}
              className="text-center text-xs font-bold text-pine-800 uppercase tracking-wider py-2"
            >
              {day}
            </div>
          ))}
        </div>
      )}

      {view === 'month' && (
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
        >
          {days.map((date, index) => {
            if (!date) {
              return (
                <div
                  key={`empty-${index}`}
                  className="aspect-square min-h-[60px]"
                />
              );
            }

            const isCurrentDay = isToday(date);
            const isSelectedDay = isSelected(date);

            return (
              <button
                key={date.toISOString()}
                onClick={() => handleDateClick(date)}
                className={`
                  aspect-square min-h-[60px] p-1 rounded-xl transition-all
                  flex items-center justify-center text-sm font-semibold
                  ${isSelectedDay
                    ? 'bg-pine-800 text-white shadow-md shadow-pine-900/30 scale-105'
                    : isCurrentDay
                    ? 'bg-pine-100 text-pine-900 ring-2 ring-pine-600'
                    : 'bg-gray-50/50 text-gray-800 hover:bg-pine-50'
                  }
                  hover:scale-105 active:scale-95
                `}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      )}

      {view === 'week' && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          {/* Day headers */}
          <div className="grid" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
            <div className="bg-pine-50/50 border-b border-gray-200" />
            {weekDates.map((date) => {
              const isCurrentDay = isToday(date);
              const isSelectedDay = isSelected(date);
              return (
                <button
                  key={`weekhead-${date.toISOString()}`}
                  onClick={() => handleDateClick(date)}
                  className={[
                    'py-2 border-b border-gray-200 text-center transition-colors',
                    isSelectedDay ? 'bg-pine-50' : 'bg-white hover:bg-pine-50/50',
                  ].join(' ')}
                >
                  <div className="text-xs font-bold text-pine-800 uppercase tracking-wider">{dayNames[date.getDay()]}</div>
                  <div
                    className={[
                      'mt-1 inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold',
                      isSelectedDay ? 'bg-pine-800 text-white' : isCurrentDay ? 'bg-pine-100 text-pine-900' : 'text-gray-800',
                    ].join(' ')}
                  >
                    {date.getDate()}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Hour grid + event overlay share the same relative container */}
          <div className="relative">
            <div className="grid" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={`hour-${hour}`} className="contents">
                  <div className="relative border-b border-gray-100 bg-pine-50/30">
                    <div className="absolute -top-2 right-2 text-[10px] font-medium text-gray-400">
                      {hour === 0 ? '' : `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? 'AM' : 'PM'}`}
                    </div>
                    <div className="h-12" />
                  </div>
                  {weekDates.map((date) => (
                    <div key={`cell-${ymdLocal(date)}-${hour}`} className="border-b border-gray-100 border-l bg-white h-12" />
                  ))}
                </div>
              ))}
            </div>

            {/* Event overlay positioned over the hour grid */}
            <div className="absolute inset-0 grid pointer-events-none" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
              <div />
              {weekDates.map((date) => {
                const dayEvents = eventsForDay(date);
                const totalHeight = 24 * 48;
                return (
                  <div key={`events-${ymdLocal(date)}`} className="relative" style={{ height: totalHeight }}>
                    {dayEvents.map((ev) => {
                      const s = new Date(ev.start);
                      const e = new Date(ev.end);
                      const top = (minutesIntoDay(s) / 1440) * totalHeight;
                      const height = clamp(((e - s) / (1000 * 60) / 1440) * totalHeight, 18, totalHeight);
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => openEventDetail(ev)}
                          className="absolute left-1 right-1 rounded-lg bg-pine-800 text-white text-xs px-2 py-1 shadow-sm shadow-pine-900/20 pointer-events-auto hover:bg-pine-900 cursor-pointer overflow-hidden border border-pine-700"
                          style={{ top, height }}
                          title={`${ev.title} · ${hmLocal(s)}–${hmLocal(e)}`}
                        >
                          <div className="font-semibold truncate">{ev.title}</div>
                          <div className="opacity-80 truncate">{hmLocal(s)}–{hmLocal(e)}</div>
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

      {view === 'day' && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          {/* Day header */}
          <div className="grid" style={{ gridTemplateColumns: '64px 1fr' }}>
            <div className="bg-pine-50/50 border-b border-gray-200" />
            <div className="bg-white border-b border-gray-200 py-2 text-center">
              <div className="text-xs font-bold text-pine-800 uppercase tracking-wider">
                {(selectedDate ?? currentDate).toLocaleDateString('en-US', { weekday: 'long' })}
              </div>
              <div className="mt-1 text-sm font-bold text-gray-900">
                {(selectedDate ?? currentDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
          </div>

          {/* Hour grid + event overlay share the same relative container */}
          <div className="relative">
            <div className="grid" style={{ gridTemplateColumns: '64px 1fr' }}>
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={`day-hour-${hour}`} className="contents">
                  <div className="relative border-b border-gray-100 bg-pine-50/30">
                    <div className="absolute -top-2 right-2 text-[10px] font-medium text-gray-400">
                      {hour === 0 ? '' : `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? 'AM' : 'PM'}`}
                    </div>
                    <div className="h-12" />
                  </div>
                  <div className="border-b border-gray-100 border-l bg-white h-12" />
                </div>
              ))}
            </div>

            {/* Event overlay positioned over the hour grid */}
            <div className="absolute inset-0 grid pointer-events-none" style={{ gridTemplateColumns: '64px 1fr' }}>
              <div />
              <div className="relative" style={{ height: 24 * 48 }}>
                {eventsForDay(selectedDate ?? currentDate).map((ev) => {
                  const s = new Date(ev.start);
                  const e = new Date(ev.end);
                  const totalHeight = 24 * 48;
                  const top = (minutesIntoDay(s) / 1440) * totalHeight;
                  const height = clamp(((e - s) / (1000 * 60) / 1440) * totalHeight, 18, totalHeight);
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => openEventDetail(ev)}
                      className="absolute left-2 right-2 rounded-lg bg-pine-800 text-white text-xs px-2 py-1 shadow-sm shadow-pine-900/20 pointer-events-auto hover:bg-pine-900 cursor-pointer overflow-hidden border border-pine-700"
                      style={{ top, height }}
                      title={`${ev.title} · ${hmLocal(s)}–${hmLocal(e)}`}
                    >
                      <div className="font-semibold truncate">{ev.title}</div>
                      <div className="opacity-80 truncate">{hmLocal(s)}–{hmLocal(e)}</div>
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
        <div className="mt-6 p-4 bg-pine-50 rounded-xl border border-pine-100">
          <p className="text-xs font-bold text-pine-700 uppercase tracking-wider mb-0.5">Selected Date</p>
          <p className="text-lg font-semibold text-gray-900">
            {selectedDate.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </p>
        </div>
      )}

      {eventModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
            {/* Modal header */}
            <div className="bg-black px-6 py-4 flex items-center justify-between">
              <h3 className="text-2xl font-bold text-white">New Event</h3>
              <button
                type="button"
                onClick={() => setEventModalOpen(false)}
                className="text-white/70 hover:text-white text-lg font-bold transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left column */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-900 uppercase tracking-wider mb-1.5">
                    Title <span className="text-red-600">*</span>
                  </label>
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border-2 border-gray-200 rounded-xl text-lg focus:outline-none focus:border-pine-700 transition-colors"
                    placeholder="Pickleball 3v3"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 uppercase tracking-wider mb-1.5">Location</label>
                  <input
                    value={draftLocation}
                    onChange={(e) => setDraftLocation(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border-2 border-gray-200 rounded-xl text-lg focus:outline-none focus:border-pine-700 transition-colors"
                    placeholder="Anderson Park, College Station"
                  />
                </div>

                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-bold text-gray-900 uppercase tracking-wider mb-1.5">Start</label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          value={draftDate}
                          onChange={(e) => setDraftDate(e.target.value)}
                          className="w-full px-3 py-2 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-pine-700 transition-colors"
                        />
                        <input
                          type="time"
                          value={draftStart}
                          onChange={(e) => setDraftStart(e.target.value)}
                          className="w-full px-3 py-2 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-pine-700 transition-colors"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-900 uppercase tracking-wider mb-1.5">End</label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          value={draftDate}
                          onChange={(e) => setDraftDate(e.target.value)}
                          className="w-full px-3 py-2 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-pine-700 transition-colors"
                        />
                        <input
                          type="time"
                          value={draftEnd}
                          onChange={(e) => setDraftEnd(e.target.value)}
                          className="w-full px-3 py-2 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-pine-700 transition-colors"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 uppercase tracking-wider mb-1.5">Details</label>
                  <div className="border-2 border-gray-200 rounded-xl overflow-hidden focus-within:border-pine-700 transition-colors">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
                      <button type="button" className="px-2 py-0.5 rounded-md font-bold text-gray-600 hover:bg-gray-200 transition-colors">
                        B
                      </button>
                      <button type="button" className="px-2 py-0.5 rounded-md italic text-gray-600 hover:bg-gray-200 transition-colors">
                        I
                      </button>
                      <button type="button" className="px-2 py-0.5 rounded-md underline text-gray-600 hover:bg-gray-200 transition-colors">
                        U
                      </button>
                    </div>
                    <textarea
                      value={draftDetails}
                      onChange={(e) => setDraftDetails(e.target.value)}
                      rows={5}
                      className="w-full px-3 py-2 bg-white text-lg focus:outline-none resize-none"
                      placeholder="We can rotate by king of the court..."
                    />
                  </div>
                </div>
              </div>

              {/* Right column */}
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-2">
                    Which group do you want to invite
                  </div>
                  <div className="border-2 border-gray-200 rounded-xl p-3 bg-pine-50/50 max-h-56 overflow-y-auto pr-2 space-y-2">
                    {groupOptions.map((g) => {
                      const checked = draftGroups.includes(g);
                      return (
                        <label key={g} className="flex items-center justify-between gap-3 cursor-pointer select-none py-1">
                          <span className="text-base font-medium">{g}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? Array.from(new Set([...draftGroups, g]))
                                : draftGroups.filter((x) => x !== g);
                              setDraftGroups(next);
                            }}
                            className="h-5 w-5 accent-pine-800 rounded"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-2">
                  <div className="text-sm font-bold text-gray-900 uppercase tracking-wider">Organizer</div>
                  <div className="text-base font-medium text-gray-700 mt-0.5">{user?.username ?? 'Unknown'}</div>
                </div>

                {eventError && (
                  <div className="p-3 rounded-xl bg-red-50 text-red-800 text-sm font-medium border border-red-200">
                    {eventError}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setEventModalOpen(false)}
                    className="px-5 py-2.5 border-2 border-gray-200 rounded-xl hover:bg-gray-50 text-gray-700 font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={createEvent}
                    className="px-5 py-2.5 rounded-xl bg-pine-800 hover:bg-pine-900 text-white font-semibold shadow-sm transition-colors"
                  >
                    Create Event
                  </button>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* Event detail / RSVP modal */}
      {viewingEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => setViewingEvent(null)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header strip */}
            <div className="bg-pine-800 px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <h3 className="text-xl font-bold text-white leading-snug">{viewingEvent.title}</h3>
                <button
                  type="button"
                  onClick={() => setViewingEvent(null)}
                  className="text-white/70 hover:text-white text-lg font-bold leading-none mt-0.5 transition-colors"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Date & time */}
              <div className="flex items-start gap-3 text-gray-700">
                <svg className="w-5 h-5 mt-0.5 shrink-0 text-pine-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <div className="font-semibold text-gray-900">
                    {new Date(viewingEvent.start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {hmLocal(viewingEvent.start)} – {hmLocal(viewingEvent.end)}
                  </div>
                </div>
              </div>

              {/* Location */}
              {viewingEvent.location && (
                <div className="flex items-start gap-3 text-gray-700">
                  <svg className="w-5 h-5 mt-0.5 shrink-0 text-pine-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="font-medium">{viewingEvent.location}</span>
                </div>
              )}

              {/* Invited groups */}
              {viewingEvent.inviteGroups?.length > 0 && (
                <div className="flex items-start gap-3 text-gray-700">
                  <svg className="w-5 h-5 mt-0.5 shrink-0 text-pine-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <span className="font-medium">{viewingEvent.inviteGroups.join(', ')}</span>
                </div>
              )}

              {/* Details */}
              {viewingEvent.details && (
                <div className="p-3 bg-pine-50 rounded-xl text-gray-700 text-sm whitespace-pre-wrap border border-pine-100">
                  {viewingEvent.details}
                </div>
              )}

              {/* RSVP */}
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Are you down?</div>
                <div className="flex gap-2">
                  {[
                    { key: 'going', label: "I'm Down!", activeClass: 'bg-pine-800 text-white border-pine-800', icon: '🤙' },
                    { key: 'maybe', label: 'Maybe', activeClass: 'bg-yellow-400 text-gray-900 border-yellow-400', icon: '🤔' },
                    { key: 'notgoing', label: "Can't Make It", activeClass: 'bg-gray-900 text-white border-gray-900', icon: '😔' },
                  ].map(({ key, label, activeClass, icon }) => {
                    const isActive = viewingEvent.rsvp === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => updateEventRsvp(viewingEvent.id, key)}
                        className={[
                          'flex-1 py-2.5 px-2 rounded-xl border-2 text-sm font-semibold transition-all text-center',
                          isActive
                            ? activeClass
                            : 'border-gray-200 text-gray-600 hover:border-pine-300 hover:bg-pine-50/50',
                        ].join(' ')}
                      >
                        <span className="block text-lg mb-0.5">{icon}</span>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Delete action */}
              <div className="flex justify-end pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    deleteEvent(viewingEvent.id);
                    setViewingEvent(null);
                  }}
                  className="text-red-500 hover:text-red-700 text-sm font-semibold transition-colors"
                >
                  Delete Event
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Calendar;
