import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const VIEW_STORAGE_KEY = 'imdown_calendar_view';
const MODE_STORAGE_KEY = 'imdown_calendar_mode';
const HIDDEN_EVENTS_KEY_PREFIX = 'imdown_hidden_events_';
const DISMISSED_NOTIFS_KEY_PREFIX = 'imdown_dismissed_notifs_';

const readIdSet = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
};

const writeIdSet = (key, set) => {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch { /* ignore */ }
};

const readHiddenEventIds = (userId) =>
  userId ? readIdSet(`${HIDDEN_EVENTS_KEY_PREFIX}${userId}`) : new Set();

const writeHiddenEventIds = (userId, set) => {
  if (!userId) return;
  writeIdSet(`${HIDDEN_EVENTS_KEY_PREFIX}${userId}`, set);
};

const readDismissedNotifIds = (userId) =>
  userId ? readIdSet(`${DISMISSED_NOTIFS_KEY_PREFIX}${userId}`) : new Set();

const writeDismissedNotifIds = (userId, set) => {
  if (!userId) return;
  writeIdSet(`${DISMISSED_NOTIFS_KEY_PREFIX}${userId}`, set);
};

// Per-viewer overrides for People-mode coloring. Shape:
//   { [groupId]: { [memberUserId]: '#rrggbb' } }
// These are local to the viewer; they don't change `group_members.color`
// in the database, so other users' calendars are unaffected.
const PEOPLE_COLORS_KEY_PREFIX = 'imdown_people_colors_';

const readPeopleColorOverrides = (userId) => {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(`${PEOPLE_COLORS_KEY_PREFIX}${userId}`);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
};

const writePeopleColorOverrides = (userId, obj) => {
  if (!userId) return;
  try {
    localStorage.setItem(
      `${PEOPLE_COLORS_KEY_PREFIX}${userId}`,
      JSON.stringify(obj)
    );
  } catch { /* ignore */ }
};

// Per-viewer visible hour window for time-grid views (week / day).
// Stored as `{ start, end }` integer hours in [0, 24]. A minimum window
// of MIN_HOUR_WINDOW hours is enforced so the grid stays readable.
const VISIBLE_HOURS_KEY_PREFIX = 'imdown_visible_hours_';
const DEFAULT_VISIBLE_HOURS = { start: 0, end: 24 };
const MIN_HOUR_WINDOW = 2;

const sanitizeVisibleHours = (raw) => {
  const s = Number.isFinite(raw?.start) ? Math.round(raw.start) : 0;
  const e = Number.isFinite(raw?.end) ? Math.round(raw.end) : 24;
  const start = Math.max(0, Math.min(24 - MIN_HOUR_WINDOW, s));
  const end = Math.max(start + MIN_HOUR_WINDOW, Math.min(24, e));
  return { start, end };
};

const readVisibleHours = (userId) => {
  if (!userId) return { ...DEFAULT_VISIBLE_HOURS };
  try {
    const raw = localStorage.getItem(`${VISIBLE_HOURS_KEY_PREFIX}${userId}`);
    if (!raw) return { ...DEFAULT_VISIBLE_HOURS };
    return sanitizeVisibleHours(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_VISIBLE_HOURS };
  }
};

const writeVisibleHours = (userId, range) => {
  if (!userId) return;
  try {
    localStorage.setItem(
      `${VISIBLE_HOURS_KEY_PREFIX}${userId}`,
      JSON.stringify(sanitizeVisibleHours(range))
    );
  } catch { /* ignore */ }
};

const formatHourShort = (h) => {
  const hour = ((h % 24) + 24) % 24;
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  const suffix = hour < 12 ? 'a' : 'p';
  const base = hour % 12 === 0 ? 12 : hour % 12;
  return `${base}${suffix}`;
};

const formatHourLong = (h) => {
  const hour = ((h % 24) + 24) % 24;
  if (hour === 0) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  const suffix = hour < 12 ? 'AM' : 'PM';
  const base = hour % 12 === 0 ? 12 : hour % 12;
  return `${base}:00 ${suffix}`;
};

const formatHourRangeShort = ({ start, end }) => {
  if (start === 0 && end === 24) return 'All day';
  return `${formatHourShort(start)}\u2013${formatHourShort(end === 24 ? 0 : end)}`;
};

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

const DEFAULT_GROUP_COLOR = '#00E676';
const PERSONAL_EVENT_COLOR = '#4B5675';
const FORMER_MEMBER_COLOR = '#94a3b8';

// Deterministic fallback palette used when a group member doesn't have a
// color set in `group_members.color`. Picked by hashing the user id so the
// same user always gets the same color across reloads.
const MEMBER_FALLBACK_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e',
];

function paletteColorFor(id) {
  const s = String(id ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return MEMBER_FALLBACK_PALETTE[h % MEMBER_FALLBACK_PALETTE.length];
}

function normalizeHex(c) {
  if (!c || typeof c !== 'string') return null;
  const s = c.trim();
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return null;
  if (s.length === 4) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return s;
}

function mixWithWhite(hex, t) {
  const n = normalizeHex(hex) || DEFAULT_GROUP_COLOR;
  const r = parseInt(n.slice(1, 3), 16);
  const g = parseInt(n.slice(3, 5), 16);
  const b = parseInt(n.slice(5, 7), 16);
  const r2 = Math.round(r + (255 - r) * t);
  const g2 = Math.round(g + (255 - g) * t);
  const b2 = Math.round(b + (255 - b) * t);
  return `rgb(${r2},${g2},${b2})`;
}

function hexToRgba(hex, alpha) {
  const n = normalizeHex(hex) || DEFAULT_GROUP_COLOR;
  const r = parseInt(n.slice(1, 3), 16);
  const g = parseInt(n.slice(3, 5), 16);
  const b = parseInt(n.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function textColorOnBg(backgroundCss) {
  if (typeof backgroundCss === 'string' && backgroundCss.startsWith('rgb(')) {
    const m = backgroundCss.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (m) {
      const r = Number(m[1]) / 255;
      const g = Number(m[2]) / 255;
      const b = Number(m[3]) / 255;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return l > 0.55 ? '#0f172a' : '#ffffff';
    }
  }
  const n = normalizeHex(backgroundCss) || DEFAULT_GROUP_COLOR;
  const r = parseInt(n.slice(1, 3), 16) / 255;
  const g = parseInt(n.slice(3, 5), 16) / 255;
  const b = parseInt(n.slice(5, 7), 16) / 255;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 0.55 ? '#0f172a' : '#ffffff';
}

/** For week/day time grid: split overlapping events into side-by-side columns. */
function getDayEventTimeLayouts(events) {
  if (!events?.length) return new Map();
  const items = events.map((ev) => ({
    ev,
    s: new Date(ev.start_time).getTime(),
    e: new Date(ev.end_time).getTime(),
  }));
  const map = new Map();
  for (const item of items) {
    const overlapping = items.filter((o) => o.e > item.s && o.s < item.e);
    overlapping.sort((a, b) => a.s - b.s || a.e - b.e);
    const colEnd = [];
    const idToCol = new Map();
    for (const o of overlapping) {
      let c = 0;
      while (c < colEnd.length && colEnd[c] > o.s) c++;
      if (c === colEnd.length) colEnd.push(o.e);
      else colEnd[c] = o.e;
      idToCol.set(o.ev.id, c);
    }
    const ncols = Math.max(1, colEnd.length);
    const col = idToCol.get(item.ev.id) ?? 0;
    const leftPct = (col / ncols) * 100;
    const widthPct = 100 / ncols;
    map.set(item.ev.id, { col, ncols, leftPct, widthPct });
  }
  return map;
}

/**
 * Small pill that renders "^ N earlier" or "v N later" for events that fall
 * outside the current visible hour window. Clicking opens an inline list;
 * clicking an entry invokes `onEventClick(ev)`.
 *
 * Pass `menuAlign` to choose where the popover appears relative to the pill
 * ("below" | "above" | "right" | "left").
 */
// Grey "Busy" marker used in People-mode to indicate a group member is busy
// at a given time without revealing the underlying event's title/details.
// Clicking it toggles a small popover that shows ONLY the time range.
//
// Accepts `className` / `style` so callers can render it either as an inline
// chip (week cell) or as an absolutely-positioned horizontal bar (day
// timeline). `layout` controls whether the label uses the "Busy" prefix or a
// short dot-icon suitable for a narrow timeline bar.
function BusyBlock({ start, end, className = '', style, layout = 'chip' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const timeRange = `${hmLocal(start)}\u2013${hmLocal(end)}`;
  const tooltip = `Busy \u00b7 ${timeRange}`;

  // For the timeline "bar" variant, the wrapper itself is absolutely
  // positioned (left/width supplied by the caller) and fills the row's
  // height. The inner div uses `h-full w-full` so the button (which is
  // `absolute inset-0`) has a non-zero box to fill — otherwise it
  // collapses into a 0-height sliver.
  const wrapperClass =
    layout === 'bar'
      ? `relative h-full w-full ${className}`
      : `relative ${className}`;

  return (
    <div ref={ref} className={wrapperClass} style={style}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={tooltip}
        aria-label={tooltip}
        className={
          layout === 'bar'
            ? 'absolute inset-0 rounded-md bg-dark-200/70 border border-dark-300 text-gray-400 text-[10px] px-1.5 overflow-hidden transition-opacity hover:bg-dark-200 text-left flex items-center'
            : 'w-full truncate text-left rounded px-1.5 py-0.5 text-[11px] leading-tight bg-dark-200/70 border border-dark-300 text-gray-400 hover:bg-dark-200 transition-opacity'
        }
        style={
          layout === 'bar'
            ? {
                backgroundImage:
                  'repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0, rgba(255,255,255,0.04) 4px, transparent 4px, transparent 8px)',
              }
            : undefined
        }
      >
        {layout === 'bar' ? (
          <span className="truncate">Busy</span>
        ) : (
          <>
            <span className="opacity-80 mr-1">{hmLocal(start)}</span>
            <span className="font-semibold">Busy</span>
          </>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={tooltip}
          className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-1 w-44 rounded-lg border border-dark-300 bg-dark-100 shadow-2xl px-3 py-2 text-xs text-gray-200"
        >
          <div className="font-semibold text-gray-300">Busy</div>
          <div className="text-gray-400">{timeRange}</div>
        </div>
      )}
    </div>
  );
}

function OverflowPill({ events, direction, menuAlign = 'below', onEventClick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!events?.length) return null;

  const count = events.length;
  const label = direction === 'earlier' ? 'earlier' : 'later';
  const icon = direction === 'earlier' ? '\u2191' : '\u2193';

  const menuPositionClass = {
    below: 'top-full left-1/2 -translate-x-1/2 mt-1',
    above: 'bottom-full left-1/2 -translate-x-1/2 mb-1',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1',
  }[menuAlign];

  return (
    <div ref={ref} className="relative inline-block pointer-events-auto">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${count} event${count === 1 ? '' : 's'} ${label} than visible range`}
        className="inline-flex items-center gap-1 text-[10px] font-semibold leading-none rounded-md bg-dark-200/90 border border-dark-300 text-gray-200 hover:bg-dark-300 px-1.5 py-1 shadow"
      >
        <span aria-hidden="true">{icon}</span>
        <span>{count} {label}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${count} ${label} event${count === 1 ? '' : 's'}`}
          className={`absolute z-30 w-56 max-h-56 overflow-y-auto rounded-lg border border-dark-300 bg-dark-100 shadow-2xl ${menuPositionClass}`}
        >
          <ul className="divide-y divide-dark-300">
            {events.map((ev) => {
              // Entries without a `title` are busy-only placeholders: render
              // them as non-clickable "Busy" rows so we don't reveal details
              // of events outside the selected group.
              if (!ev.title) {
                return (
                  <li key={ev.id}>
                    <div className="w-full px-3 py-2 text-xs text-gray-400">
                      <div className="font-semibold text-gray-300">Busy</div>
                      <div className="text-gray-400">
                        {hmLocal(ev.start_time)}&ndash;{hmLocal(ev.end_time)}
                      </div>
                    </div>
                  </li>
                );
              }
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      onEventClick?.(ev);
                    }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-dark-200 text-gray-200"
                  >
                    <div className="font-semibold truncate">{ev.title}</div>
                    <div className="text-gray-400">
                      {hmLocal(ev.start_time)}&ndash;{hmLocal(ev.end_time)}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

const Calendar = ({ user, groups, selectedGroupId, refreshKey }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [view, setView] = useState(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === 'week' || stored === 'day' || stored === 'month' ? stored : 'month';
  });
  const [mode, setMode] = useState(() => {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    return stored === 'people' ? 'people' : 'groups';
  });
  const [groupMembers, setGroupMembers] = useState([]);
  // Map<user_id, Array<{ id, start_time, end_time }>> of busy-time slivers
  // for People-mode rendering. Populated only when a specific group is
  // selected and `mode === 'people'`. Title/location/details are intentionally
  // not fetched so the UI can render opaque "Busy" blocks.
  const [busyByUser, setBusyByUser] = useState(() => new Map());

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [hiddenEventIds, setHiddenEventIds] = useState(() => readHiddenEventIds(user?.id));
  const [dismissedNotifIds, setDismissedNotifIds] = useState(() => readDismissedNotifIds(user?.id));
  const [peopleColorOverrides, setPeopleColorOverrides] = useState(() => readPeopleColorOverrides(user?.id));
  const [visibleHours, setVisibleHoursState] = useState(() => readVisibleHours(user?.id));
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const hoursRef = useRef(null);

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

    setEventsLoading(true);
    try {
      const byId = new Map();

      // Personal events: created by you with no group links
      const { data: mineRows, error: mineErr } = await supabase
        .from('events')
        .select('*, event_rsvps(user_id, status, users(username)), event_groups(group_id)')
        .eq('created_by', user.id)
        .order('start_time', { ascending: true });

      if (mineErr) throw mineErr;
      for (const ev of mineRows || []) {
        const links = ev.event_groups;
        const linkCount = Array.isArray(links) ? links.length : 0;
        if (linkCount === 0) {
          byId.set(ev.id, ev);
        }
      }

      // Group-shared events (when you have at least one group in scope)
      if (groupIds.length > 0) {
        const { data: links, error: linksErr } = await supabase
          .from('event_groups')
          .select('event_id')
          .in('group_id', groupIds);

        if (linksErr) throw linksErr;

        const eventIds = [...new Set((links || []).map((l) => l.event_id))];
        if (eventIds.length > 0) {
          const { data: groupEvents, error: geErr } = await supabase
            .from('events')
            .select('*, event_rsvps(user_id, status, users(username)), event_groups(group_id, groups(id, name))')
            .in('id', eventIds)
            .order('start_time', { ascending: true });

          if (geErr) throw geErr;
          for (const ev of groupEvents || []) {
            byId.set(ev.id, ev);
          }
        }
      }

      const merged = [...byId.values()].sort(
        (a, b) => new Date(a.start_time) - new Date(b.start_time)
      );
      setEvents(merged);
    } catch (err) {
      console.error('Failed to fetch events:', err.message);
    } finally {
      setEventsLoading(false);
    }
  }, [user?.id, selectedGroupId, groups, refreshKey]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Re-load the per-user "hidden events", "dismissed notifications",
  // People-mode color overrides, and visible-hours window whenever the
  // logged-in user changes.
  useEffect(() => {
    setHiddenEventIds(readHiddenEventIds(user?.id));
    setDismissedNotifIds(readDismissedNotifIds(user?.id));
    setPeopleColorOverrides(readPeopleColorOverrides(user?.id));
    setVisibleHoursState(readVisibleHours(user?.id));
  }, [user?.id]);

  // Wrapper that writes through to localStorage on every update, so the
  // slider / preset buttons stay persistent across reloads. Uses the
  // functional form of the underlying setter so rapid slider drags always
  // see the latest state.
  const setVisibleHours = useCallback(
    (next) => {
      setVisibleHoursState((prev) => {
        const sanitized = sanitizeVisibleHours(
          typeof next === 'function' ? next(prev) : next
        );
        writeVisibleHours(user?.id, sanitized);
        return sanitized;
      });
    },
    [user?.id]
  );

  // Derived hour-window helpers used by the time-grid views below.
  const visibleStartMin = visibleHours.start * 60;
  const visibleEndMin = visibleHours.end * 60;
  const visibleWindowMin = visibleEndMin - visibleStartMin;
  const visibleHourCount = visibleHours.end - visibleHours.start;

  // Auto-reset mode to 'groups' whenever we leave a specific-group view,
  // since People mode is only meaningful when a single group is selected.
  useEffect(() => {
    if (selectedGroupId === 'all' && mode !== 'groups') {
      setMode('groups');
      localStorage.setItem(MODE_STORAGE_KEY, 'groups');
    }
  }, [selectedGroupId, mode]);

  // Fetch members of the selected group when we need them for People mode
  // (used for legend + per-creator color resolution). Clear otherwise.
  useEffect(() => {
    let cancelled = false;
    if (selectedGroupId === 'all' || mode !== 'people' || !user?.id) {
      setGroupMembers([]);
      return () => { cancelled = true; };
    }

    (async () => {
      try {
        const { data, error } = await supabase
          .from('group_members')
          .select('user_id, color, users(username)')
          .eq('group_id', selectedGroupId);

        if (error) throw error;
        if (cancelled) return;

        const rows = (data || []).map((row) => ({
          user_id: row.user_id,
          username: row.users?.username || 'Unknown',
          color: normalizeHex(row.color) || paletteColorFor(row.user_id),
        }));
        rows.sort((a, b) => a.username.localeCompare(b.username));
        setGroupMembers(rows);
      } catch (err) {
        console.error('Failed to fetch group members:', err.message);
        if (!cancelled) setGroupMembers([]);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedGroupId, mode, user?.id]);

  // Close the notifications popover on outside click / Escape key.
  useEffect(() => {
    if (!notificationsOpen) return undefined;
    const onDown = (e) => {
      if (notificationsRef.current && !notificationsRef.current.contains(e.target)) {
        setNotificationsOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setNotificationsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [notificationsOpen]);

  // Close the hours popover on outside click / Escape key.
  useEffect(() => {
    if (!hoursOpen) return undefined;
    const onDown = (e) => {
      if (hoursRef.current && !hoursRef.current.contains(e.target)) {
        setHoursOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setHoursOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [hoursOpen]);

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

      if (draftGroups.length > 0) {
        const { error: linkErr } = await supabase
          .from('event_groups')
          .insert(draftGroups.map((gid) => ({ event_id: event.id, group_id: gid })));

        if (linkErr) throw linkErr;
      }

      setEventModalOpen(false);
      fetchEvents();
    } catch (err) {
      setEventError(err.message || 'Failed to create event.');
    } finally {
      setSaving(false);
    }
  };

  // Per-user hide: removes the event from this user's calendar view only.
  // Does NOT touch the events table; other invitees still see it.
  const hideEventFromMyCalendar = (eventId) => {
    setHiddenEventIds((prev) => {
      const next = new Set(prev);
      next.add(eventId);
      writeHiddenEventIds(user?.id, next);
      return next;
    });
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
        {
          user_id: user.id,
          status,
          responded_at: new Date().toISOString(),
          users: user?.username ? { username: user.username } : null,
        },
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

  const getRsvpNamesByStatus = (ev) => {
    const rsvps = ev?.event_rsvps || [];
    const nameFor = (r) => r?.users?.username || `User #${r.user_id}`;
    const sortNames = (arr) => [...arr].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return {
      going: sortNames(rsvps.filter((r) => r.status === 'going').map(nameFor)),
      maybe: sortNames(rsvps.filter((r) => r.status === 'maybe').map(nameFor)),
      notgoing: sortNames(rsvps.filter((r) => r.status === 'notgoing').map(nameFor)),
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

  const handleModeChange = (nextMode) => {
    if (nextMode !== 'groups' && nextMode !== 'people') return;
    setMode(nextMode);
    localStorage.setItem(MODE_STORAGE_KEY, nextMode);
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
      if (hiddenEventIds.has(e.id)) return false;
      const s = new Date(e.start_time).getTime();
      const en = new Date(e.end_time).getTime();
      return en > startMs && s < endMs;
    });
  }, [events, visibleStart, visibleEnd, hiddenEventIds]);

  // Per-member set of event IDs that render as full colored chips on that
  // member's row in People mode. A member "owns" an event visually if they
  // created it OR RSVP'd `going` / `maybe` to it — both should show the
  // colored chip with details (creator's color is preserved via
  // getEventTheme for attribution). The busy-overlay renderer uses this to
  // avoid showing the same event as both colored AND grey on a single row.
  const visibleColoredIdsByMember = useMemo(() => {
    const map = new Map();
    const add = (uid, eid) => {
      if (!uid) return;
      let set = map.get(uid);
      if (!set) {
        set = new Set();
        map.set(uid, set);
      }
      set.add(eid);
    };
    for (const ev of eventsInRange) {
      add(ev.created_by, ev.id);
      const rsvps = ev.event_rsvps || [];
      for (const r of rsvps) {
        if (r.status === 'going' || r.status === 'maybe') {
          add(r.user_id, ev.id);
        }
      }
    }
    return map;
  }, [eventsInRange]);

  // ── People-mode busy overlay ──────────────────────────────────────────
  // Fetch a minimal "free/busy" projection for each member of the selected
  // group: only `{ id, start_time, end_time }`, never titles/locations.
  // Two sources are merged per member:
  //   1. Events they CREATED (any group, including private)
  //   2. Events they RSVP'd `going` OR `maybe` to (created by anyone)
  // `notgoing` is treated as free; intent (going vs maybe) is never exposed.
  useEffect(() => {
    let cancelled = false;
    if (
      selectedGroupId === 'all' ||
      mode !== 'people' ||
      !user?.id ||
      groupMembers.length === 0
    ) {
      setBusyByUser(new Map());
      return () => { cancelled = true; };
    }

    const memberIds = groupMembers.map((m) => m.user_id);
    const startIso = visibleStart.toISOString();
    const endIso = visibleEnd.toISOString();
    const visibleStartMs = visibleStart.getTime();
    const visibleEndMs = visibleEnd.getTime();

    (async () => {
      try {
        // Run both queries in parallel. We don't range-filter the RSVP join
        // server-side; we overlap-filter the joined rows client-side below.
        const [createdRes, goingRes] = await Promise.all([
          supabase
            .from('events')
            .select('id, created_by, start_time, end_time')
            .in('created_by', memberIds)
            .lt('start_time', endIso)
            .gt('end_time', startIso),
          supabase
            .from('event_rsvps')
            .select('user_id, events(id, start_time, end_time)')
            .in('user_id', memberIds)
            .in('status', ['going', 'maybe']),
        ]);

        if (createdRes.error) throw createdRes.error;
        if (goingRes.error) throw goingRes.error;
        if (cancelled) return;

        const next = new Map();
        const seenPerUser = new Map();

        const push = (userId, ev) => {
          if (!userId || !ev || !ev.id) return;
          const s = new Date(ev.start_time).getTime();
          const e = new Date(ev.end_time).getTime();
          if (Number.isNaN(s) || Number.isNaN(e)) return;
          if (e <= visibleStartMs || s >= visibleEndMs) return;
          let seen = seenPerUser.get(userId);
          if (!seen) {
            seen = new Set();
            seenPerUser.set(userId, seen);
          }
          if (seen.has(ev.id)) return;
          seen.add(ev.id);
          let bucket = next.get(userId);
          if (!bucket) {
            bucket = [];
            next.set(userId, bucket);
          }
          bucket.push({ id: ev.id, start_time: ev.start_time, end_time: ev.end_time });
        };

        for (const row of createdRes.data || []) {
          push(row.created_by, row);
        }
        for (const row of goingRes.data || []) {
          // Supabase may return `events` as an object or an array depending
          // on the relationship cardinality; normalize here.
          const ev = Array.isArray(row.events) ? row.events[0] : row.events;
          push(row.user_id, ev);
        }

        for (const bucket of next.values()) {
          bucket.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
        }

        setBusyByUser(next);
      } catch (err) {
        console.error('Failed to fetch busy times:', err.message);
        if (!cancelled) setBusyByUser(new Map());
      }
    })();

    return () => { cancelled = true; };
  }, [selectedGroupId, mode, user?.id, groupMembers, visibleStart, visibleEnd]);

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

  // Pending event invitations: events from the user's groups that haven't ended,
  // that the user did not create, isn't hidden, isn't dismissed from the
  // notifications panel, and that the user hasn't yet RSVP'd to. These power
  // the bell icon's notification popup.
  const pendingInvites = useMemo(() => {
    if (!user?.id) return [];
    const now = Date.now();
    return events
      .filter((ev) => {
        if (ev.created_by === user.id) return false;
        if (hiddenEventIds.has(ev.id)) return false;
        if (dismissedNotifIds.has(ev.id)) return false;
        if (new Date(ev.end_time).getTime() <= now) return false;
        const rsvp = ev.event_rsvps?.find((r) => r.user_id === user.id);
        return !rsvp;
      })
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  }, [events, hiddenEventIds, dismissedNotifIds, user?.id]);

  // Clear the notifications panel without changing RSVPs or hiding events.
  // Adds every currently-pending invite id to the per-user dismissed set so
  // they won't reappear; future events not yet seen will still show up.
  const clearAllNotifications = () => {
    if (pendingInvites.length === 0) return;
    setDismissedNotifIds((prev) => {
      const next = new Set(prev);
      pendingInvites.forEach((ev) => next.add(ev.id));
      writeDismissedNotifIds(user?.id, next);
      return next;
    });
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

  /** No `event_groups` rows — private / not shared with a group; no RSVP UI. */
  const isPersonalEvent = (ev) => !(ev?.event_groups && ev.event_groups.length > 0);

  const groupColorById = useMemo(() => {
    const m = new Map();
    for (const g of groups) {
      m.set(g.id, normalizeHex(g.color) || DEFAULT_GROUP_COLOR);
    }
    return m;
  }, [groups]);

  // Effective color per member in the selected group: a per-viewer override
  // wins over the member's own color, which in turn beats the deterministic
  // palette fallback already encoded in groupMembers.
  const memberColorById = useMemo(() => {
    const m = new Map();
    const overrides =
      selectedGroupId !== 'all'
        ? (peopleColorOverrides?.[selectedGroupId] || {})
        : {};
    for (const mem of groupMembers) {
      const override = normalizeHex(overrides[mem.user_id]);
      m.set(mem.user_id, override || mem.color);
    }
    return m;
  }, [groupMembers, peopleColorOverrides, selectedGroupId]);

  const hasPersonColorOverride = (memberUserId) => {
    if (selectedGroupId === 'all') return false;
    const bucket = peopleColorOverrides?.[selectedGroupId];
    return Boolean(bucket && bucket[memberUserId]);
  };

  const setPersonColor = (memberUserId, hex) => {
    if (selectedGroupId === 'all' || !user?.id) return;
    const normalized = normalizeHex(hex);
    if (!normalized) return;
    setPeopleColorOverrides((prev) => {
      const next = { ...(prev || {}) };
      const bucket = { ...(next[selectedGroupId] || {}) };
      bucket[memberUserId] = normalized;
      next[selectedGroupId] = bucket;
      writePeopleColorOverrides(user.id, next);
      return next;
    });
  };

  const resetPersonColor = (memberUserId) => {
    if (selectedGroupId === 'all' || !user?.id) return;
    setPeopleColorOverrides((prev) => {
      const next = { ...(prev || {}) };
      const bucket = { ...(next[selectedGroupId] || {}) };
      if (!(memberUserId in bucket)) return prev;
      delete bucket[memberUserId];
      if (Object.keys(bucket).length === 0) {
        delete next[selectedGroupId];
      } else {
        next[selectedGroupId] = bucket;
      }
      writePeopleColorOverrides(user.id, next);
      return next;
    });
  };

  // Resolve the base color for an event based on the active mode.
  //   - People mode (only valid when a specific group is selected): the event
  //     creator's color in that group, falling back to a neutral gray for
  //     creators who are no longer members.
  //   - Groups mode + specific group: that group's color.
  //   - Groups mode + All Groups: the first event_groups entry whose group is
  //     among the user's groups, falling back to the personal event color
  //     when the event has no group links at all.
  const resolveEventBaseColor = (ev) => {
    const links = Array.isArray(ev.event_groups) ? ev.event_groups : [];

    if (mode === 'people' && selectedGroupId !== 'all') {
      return memberColorById.get(ev.created_by) || FORMER_MEMBER_COLOR;
    }

    if (selectedGroupId !== 'all') {
      return groupColorById.get(selectedGroupId) || DEFAULT_GROUP_COLOR;
    }

    if (links.length === 0) return PERSONAL_EVENT_COLOR;
    const sorted = [...links].sort((a, b) =>
      String(a.group_id).localeCompare(String(b.group_id))
    );
    for (const link of sorted) {
      const c = normalizeHex(groupColorById.get(link.group_id));
      if (c) return c;
    }
    return DEFAULT_GROUP_COLOR;
  };

  const isTentativeEvent = (ev) => {
    if (isMine(ev)) return false;
    if (isPersonalEvent(ev)) return false;
    const rsvp = getUserRsvp(ev);
    return rsvp !== 'going' && rsvp !== 'maybe';
  };

  const getEventTheme = (ev) => {
    const mine = isMine(ev);
    const baseHex = resolveEventBaseColor(ev);
    const tentative = isTentativeEvent(ev);

    if (tentative) {
      return {
        backgroundColor: hexToRgba(baseHex, 0.12),
        borderLeft: `3px solid ${baseHex}`,
        color: mixWithWhite(baseHex, 0.25),
      };
    }

    const backgroundColor = mine ? baseHex : mixWithWhite(baseHex, 0.38);
    return {
      backgroundColor,
      color: textColorOnBg(backgroundColor),
    };
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
    return `${startLabel} – ${endLabel}, ${weekEnd.getFullYear()}`;
  })();

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-dark-50 rounded-2xl border border-dark-200">
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <button
          onClick={goToPrevious}
          className="p-2 hover:bg-dark-200 rounded-lg transition-colors text-gray-400 hover:text-neon"
          aria-label={view === 'month' ? 'Previous month' : view === 'week' ? 'Previous week' : 'Previous day'}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-gray-100">{headerText}</h2>
          <button onClick={goToToday} className="btn-primary text-sm py-2 shrink-0 whitespace-nowrap">
            Today
          </button>
          <button onClick={openCreateEvent} className="btn-outline text-sm py-2 shrink-0 whitespace-nowrap">
            + Event
          </button>
          <div className="inline-flex rounded-xl bg-dark-100 border border-dark-300 p-1 gap-0.5">
            {['month', 'week', 'day'].map((v) => {
              const active = view === v;
              return (
                <button
                  key={v}
                  onClick={() => handleViewChange(v)}
                  className={[
                    'px-3.5 py-1.5 text-sm font-semibold rounded-lg transition-all duration-150 tracking-tight',
                    active
                      ? 'bg-neon text-dark shadow-md shadow-neon/20'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-dark-200',
                  ].join(' ')}
                  aria-pressed={active}
                >
                  {v[0].toUpperCase() + v.slice(1)}
                </button>
              );
            })}
          </div>

          {selectedGroupId !== 'all' && (
            <div
              className="inline-flex rounded-xl bg-dark-100 border border-dark-300 p-1 gap-0.5"
              role="group"
              aria-label="Color events by"
            >
              {['groups', 'people'].map((m) => {
                const active = mode === m;
                return (
                  <button
                    key={m}
                    onClick={() => handleModeChange(m)}
                    className={[
                      'px-3.5 py-1.5 text-sm font-semibold rounded-lg transition-all duration-150 tracking-tight',
                      active
                        ? 'bg-neon text-dark shadow-md shadow-neon/20'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-dark-200',
                    ].join(' ')}
                    aria-pressed={active}
                    title={m === 'groups' ? 'Color events by group' : 'Color events by person in this group'}
                  >
                    {m === 'groups' ? 'Groups' : 'People'}
                  </button>
                );
              })}
            </div>
          )}

          {/* Visible-hours popover (only meaningful for time-grid views) */}
          {(view === 'week' || view === 'day') && (
            <div className="relative" ref={hoursRef}>
              <button
                type="button"
                onClick={() => setHoursOpen((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={hoursOpen}
                title="Adjust the visible hour range"
                className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg bg-dark-100 border border-dark-300 text-gray-200 hover:bg-dark-200 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{formatHourRangeShort(visibleHours)}</span>
              </button>

              {hoursOpen && (
                <div
                  role="dialog"
                  aria-label="Visible hours"
                  className="absolute right-0 mt-2 w-80 max-w-[90vw] z-40 rounded-xl border border-dark-300 bg-dark-100 shadow-2xl overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-dark-300 bg-dark-200/50 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-neon-200">Visible hours</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Limit the week and day views to a specific range.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setHoursOpen(false)}
                      aria-label="Close"
                      className="text-gray-500 hover:text-gray-300 text-sm leading-none shrink-0"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="p-4 space-y-4">
                    <div className="text-center">
                      <div className="text-base font-semibold text-gray-100">
                        {formatHourLong(visibleHours.start)}
                        <span className="mx-2 text-gray-500">–</span>
                        {visibleHours.end === 24 ? '12:00 AM' : formatHourLong(visibleHours.end)}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {visibleHourCount} hour{visibleHourCount === 1 ? '' : 's'} shown
                      </div>
                    </div>

                    {/* Dual slider: start and end hours. The minimum gap of
                        MIN_HOUR_WINDOW hours is enforced by the setter. */}
                    <div className="space-y-3">
                      <label className="block">
                        <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                          <span>Start</span>
                          <span className="font-semibold text-gray-200">
                            {formatHourLong(visibleHours.start)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={24 - MIN_HOUR_WINDOW}
                          step={1}
                          value={visibleHours.start}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setVisibleHours((prev) => {
                              const start = clamp(next, 0, 24 - MIN_HOUR_WINDOW);
                              const end = Math.max(prev.end, start + MIN_HOUR_WINDOW);
                              return { start, end: Math.min(24, end) };
                            });
                          }}
                          className="w-full accent-neon"
                          aria-label="Start hour"
                        />
                      </label>
                      <label className="block">
                        <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                          <span>End</span>
                          <span className="font-semibold text-gray-200">
                            {visibleHours.end === 24 ? '12:00 AM' : formatHourLong(visibleHours.end)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={MIN_HOUR_WINDOW}
                          max={24}
                          step={1}
                          value={visibleHours.end}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setVisibleHours((prev) => {
                              const end = clamp(next, MIN_HOUR_WINDOW, 24);
                              const start = Math.min(prev.start, end - MIN_HOUR_WINDOW);
                              return { start: Math.max(0, start), end };
                            });
                          }}
                          className="w-full accent-neon"
                          aria-label="End hour"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'All day', range: { start: 0, end: 24 } },
                        { label: 'Work 8a–6p', range: { start: 8, end: 18 } },
                        { label: 'Waking 7a–11p', range: { start: 7, end: 23 } },
                      ].map((preset) => {
                        const active =
                          visibleHours.start === preset.range.start &&
                          visibleHours.end === preset.range.end;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => setVisibleHours(preset.range)}
                            className={[
                              'px-2 py-1.5 text-xs font-semibold rounded-md border transition-colors',
                              active
                                ? 'bg-neon text-dark border-neon'
                                : 'bg-dark-200 text-gray-300 border-dark-300 hover:bg-dark-300',
                            ].join(' ')}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => setVisibleHours(DEFAULT_VISIBLE_HOURS)}
                        disabled={
                          visibleHours.start === 0 && visibleHours.end === 24
                        }
                        className="text-xs font-medium text-gray-400 hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Reset to all day
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notifications bell + popover */}
          <div className="relative" ref={notificationsRef}>
            <button
              type="button"
              onClick={() => setNotificationsOpen((v) => !v)}
              aria-label={`Notifications${pendingInvites.length ? ` (${pendingInvites.length} pending)` : ''}`}
              aria-haspopup="dialog"
              aria-expanded={notificationsOpen}
              className="relative p-2 rounded-lg hover:bg-dark-200 transition-colors"
            >
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {pendingInvites.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-neon text-dark text-[10px] font-bold leading-none">
                  {pendingInvites.length > 99 ? '99+' : pendingInvites.length}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div
                role="dialog"
                aria-label="Event invitations"
                className="absolute right-0 mt-2 w-96 max-w-[90vw] z-40 rounded-xl border border-dark-300 bg-dark-100 shadow-2xl overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-dark-300 bg-dark-200/50 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-neon-200">Event invitations</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Tap an event to view details and RSVP.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={clearAllNotifications}
                      disabled={pendingInvites.length === 0}
                      className="px-2 py-1 text-xs font-semibold rounded-md text-neon hover:bg-dark-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen(false)}
                      aria-label="Close notifications"
                      className="text-gray-500 hover:text-gray-300 text-sm leading-none"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {pendingInvites.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-gray-500">
                    You&apos;re all caught up!
                  </div>
                ) : (
                  <ul className="divide-y divide-dark-300 max-h-96 overflow-y-auto">
                    {pendingInvites.map((ev) => {
                      const start = new Date(ev.start_time);
                      const dateLabel = start.toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      });
                      return (
                        <li key={ev.id}>
                          <button
                            type="button"
                            onClick={() => {
                              openEventDetail(ev);
                              setNotificationsOpen(false);
                            }}
                            className="block w-full text-left px-4 py-3 hover:bg-dark-200 transition-colors"
                          >
                            <p className="text-sm font-semibold text-gray-100 truncate">{ev.title}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {dateLabel} · {hmLocal(ev.start_time)}–{hmLocal(ev.end_time)}
                            </p>
                            {ev.location && (
                              <p className="text-xs text-gray-500 mt-0.5 truncate">{ev.location}</p>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={goToNext}
          className="p-2 hover:bg-dark-200 rounded-lg transition-colors text-gray-400 hover:text-neon"
          aria-label={view === 'month' ? 'Next month' : view === 'week' ? 'Next week' : 'Next day'}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Color legend: reflects the active mode (groups vs people).
          In People mode each swatch is a color picker so the viewer can
          recolor anyone in this group; per-viewer overrides are persisted
          locally and don't affect anyone else's calendar. */}
      {(() => {
        let items = [];
        let label = '';
        const isPeople = mode === 'people' && selectedGroupId !== 'all';

        if (isPeople) {
          label = 'People';
          items = groupMembers.map((m) => {
            const color = memberColorById.get(m.user_id) || m.color;
            return {
              key: `person-${m.user_id}`,
              userId: m.user_id,
              color,
              name: m.user_id === user?.id ? `${m.username} (you)` : m.username,
              editable: true,
            };
          });
        } else if (selectedGroupId !== 'all') {
          const g = groups.find((x) => x.id === selectedGroupId);
          label = 'Group';
          items = g
            ? [{
                key: `group-${g.id}`,
                color: normalizeHex(g.color) || DEFAULT_GROUP_COLOR,
                name: g.name,
                editable: false,
              }]
            : [];
        } else {
          label = 'Groups';
          items = groups.map((g) => ({
            key: `group-${g.id}`,
            color: normalizeHex(g.color) || DEFAULT_GROUP_COLOR,
            name: g.name,
            editable: false,
          }));
        }

        if (items.length === 0) return null;

        return (
          <div className="mb-4 flex items-center flex-wrap gap-x-4 gap-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {label}
            </span>
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {items.map((it) => {
                if (!it.editable) {
                  return (
                    <li key={it.key} className="flex items-center gap-1.5 text-xs text-gray-700">
                      <span
                        aria-hidden="true"
                        className="inline-block w-3 h-3 rounded-sm border border-black/10"
                        style={{ backgroundColor: it.color }}
                      />
                      <span className="truncate max-w-[12rem]">{it.name}</span>
                    </li>
                  );
                }

                const overridden = hasPersonColorOverride(it.userId);
                return (
                  <li key={it.key} className="flex items-center gap-1.5 text-xs text-gray-700">
                    <label
                      className="relative inline-block w-3 h-3 rounded-sm border border-black/10 cursor-pointer hover:ring-2 hover:ring-black/20"
                      style={{ backgroundColor: it.color }}
                      title={`Change color for ${it.name}`}
                    >
                      <input
                        type="color"
                        value={normalizeHex(it.color) || DEFAULT_GROUP_COLOR}
                        onChange={(e) => setPersonColor(it.userId, e.target.value)}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        aria-label={`Change color for ${it.name}`}
                      />
                    </label>
                    <span className="truncate max-w-[12rem]">{it.name}</span>
                    {overridden && (
                      <button
                        type="button"
                        onClick={() => resetPersonColor(it.userId)}
                        className="text-[10px] font-medium text-gray-400 hover:text-gray-700"
                        title="Reset to default color"
                        aria-label={`Reset color for ${it.name}`}
                      >
                        reset
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}

      {eventsLoading && (
        <div className="text-center py-2 text-sm text-neon/60">Loading events...</div>
      )}

      {/* Day-name header row (month view only; week view has its own header). */}
      {view === 'month' && (
        <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {dayNames.map((day) => (
            <div key={day} className="text-center text-sm font-semibold text-gray-500 py-2">{day}</div>
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
                    ? 'bg-dark-100 ring-2 ring-neon/50 shadow-lg shadow-neon/5'
                    : isCurrentDay
                    ? 'bg-neon/5 border border-neon/30'
                    : 'bg-dark-100/50 hover:bg-dark-200',
                ].join(' ')}
              >
                <div className="flex justify-end">
                  <span
                    className={[
                      'inline-flex items-center justify-center h-6 min-w-[24px] px-1 rounded-full text-xs font-semibold',
                      isCurrentDay
                        ? 'bg-neon text-dark'
                        : isSelectedDay
                        ? 'text-neon-200'
                        : 'text-gray-400',
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
                      style={getEventTheme(ev)}
                      className={`w-full truncate text-left rounded px-1.5 py-0.5 text-[11px] leading-tight transition-opacity hover:opacity-90${isTentativeEvent(ev) ? ' event-tentative' : ''}`}
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
      {view === 'week' && !(mode === 'people' && selectedGroupId !== 'all') && (
        <div className="border border-dark-300 rounded-lg overflow-hidden">
          <div className="grid" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
            <div className="bg-dark-100 border-b border-dark-300" />
            {weekDates.map((date) => {
              const isCurrentDay = isToday(date);
              const isSelectedDay = isSelected(date);
              return (
                <button
                  key={`weekhead-${date.toISOString()}`}
                  onClick={() => handleDateClick(date)}
                  className={[
                    'py-2 border-b border-dark-300 text-center transition-colors',
                    isSelectedDay ? 'bg-neon/10' : 'bg-dark-100 hover:bg-dark-200',
                  ].join(' ')}
                >
                  <div className="text-xs font-semibold text-gray-500">{dayNames[date.getDay()]}</div>
                  <div className={[
                    'mt-1 inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold',
                    isSelectedDay ? 'bg-neon text-dark' : isCurrentDay ? 'bg-neon/20 text-neon' : 'text-gray-300',
                  ].join(' ')}>
                    {date.getDate()}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="relative">
            <div className="grid" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
              {Array.from({ length: visibleHourCount }, (_, i) => {
                const hour = visibleHours.start + i;
                return (
                  <div key={`hour-${hour}`} className="contents">
                    <div className="relative border-b border-dark-200 bg-dark-100">
                      <div className="absolute -top-2 right-2 text-[10px] text-gray-600">
                        {i === 0 ? '' : `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 || hour === 24 ? 'AM' : 'PM'}`}
                      </div>
                      <div className="h-12" />
                    </div>
                    {weekDates.map((date) => (
                      <div key={`cell-${ymdLocal(date)}-${hour}`} className="border-b border-dark-200 border-l border-dark-200 bg-dark-50 h-12" />
                    ))}
                  </div>
                );
              })}
            </div>

            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
              <div className="pointer-events-none" />
              {weekDates.map((date) => {
                const dayEvents = eventsForDay(date);
                const timeLayouts = getDayEventTimeLayouts(dayEvents);
                const totalHeight = visibleHourCount * 48;
                const dayStartMs = startOfDay(date).getTime();
                const dayEndMs = addDays(startOfDay(date), 1).getTime();

                // Partition events into fully-earlier / fully-later /
                // overlapping-visible-window buckets for this day.
                const earlier = [];
                const later = [];
                const overlapping = [];
                for (const ev of dayEvents) {
                  const s = new Date(ev.start_time).getTime();
                  const e = new Date(ev.end_time).getTime();
                  const startInDay = s < dayStartMs ? 0 : minutesIntoDay(new Date(s));
                  const endInDay = e >= dayEndMs ? 1440 : minutesIntoDay(new Date(e));
                  if (endInDay <= visibleStartMin) earlier.push(ev);
                  else if (startInDay >= visibleEndMin) later.push(ev);
                  else overlapping.push(ev);
                }

                return (
                  <div
                    key={`events-${ymdLocal(date)}`}
                    className="relative pointer-events-none"
                    style={{ height: totalHeight }}
                  >
                    {overlapping.map((ev) => {
                      const s = new Date(ev.start_time);
                      const e = new Date(ev.end_time);
                      const startInDay = s.getTime() < dayStartMs ? 0 : minutesIntoDay(s);
                      const endInDay = e.getTime() >= dayEndMs ? 1440 : minutesIntoDay(e);
                      const clampedStart = Math.max(startInDay, visibleStartMin);
                      const clampedEnd = Math.min(endInDay, visibleEndMin);
                      const top = ((clampedStart - visibleStartMin) / visibleWindowMin) * totalHeight;
                      const height = clamp(
                        ((clampedEnd - clampedStart) / visibleWindowMin) * totalHeight,
                        18,
                        totalHeight - top
                      );
                      const h = timeLayouts.get(ev.id) || { leftPct: 0, widthPct: 100 };
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => openEventDetail(ev)}
                          className={`absolute rounded-md text-xs px-1.5 py-0.5 shadow pointer-events-auto cursor-pointer overflow-hidden transition-opacity hover:opacity-90${isTentativeEvent(ev) ? ' event-tentative' : ''}`}
                          style={{
                            top,
                            height,
                            left: `calc(${h.leftPct}% + 2px)`,
                            width: `calc(${h.widthPct}% - 4px)`,
                            right: 'auto',
                            ...getEventTheme(ev),
                          }}
                          title={`${ev.title} · ${hmLocal(s)}–${hmLocal(e)}`}
                        >
                          <div className="font-semibold truncate">{ev.title}</div>
                          <div className="opacity-90 truncate">{hmLocal(s)}–{hmLocal(e)}</div>
                        </button>
                      );
                    })}

                    {earlier.length > 0 && (
                      <div className="absolute top-1 left-1/2 -translate-x-1/2">
                        <OverflowPill
                          events={earlier}
                          direction="earlier"
                          menuAlign="below"
                          onEventClick={openEventDetail}
                        />
                      </div>
                    )}
                    {later.length > 0 && (
                      <div className="absolute bottom-1 left-1/2 -translate-x-1/2">
                        <OverflowPill
                          events={later}
                          direction="later"
                          menuAlign="above"
                          onEventClick={openEventDetail}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Week view (People mode): rows = people, columns = days ───── */}
      {view === 'week' && mode === 'people' && selectedGroupId !== 'all' && (
        <div className="border border-dark-300 rounded-lg overflow-hidden">
          {/* Day header */}
          <div
            className="grid bg-dark-100"
            style={{ gridTemplateColumns: '160px repeat(7, minmax(0, 1fr))' }}
          >
            <div className="px-3 py-2 border-b border-dark-300 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Person
            </div>
            {weekDates.map((date) => {
              const isCurrentDay = isToday(date);
              const isSelectedDay = isSelected(date);
              return (
                <button
                  key={`pweekhead-${date.toISOString()}`}
                  type="button"
                  onClick={() => handleDateClick(date)}
                  className={[
                    'py-2 border-b border-l border-dark-300 text-center transition-colors',
                    isSelectedDay ? 'bg-neon/10' : 'hover:bg-dark-200',
                  ].join(' ')}
                >
                  <div className="text-xs font-semibold text-gray-400">{dayNames[date.getDay()]}</div>
                  <div
                    className={[
                      'mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold',
                      isSelectedDay
                        ? 'bg-neon text-dark'
                        : isCurrentDay
                        ? 'bg-neon/20 text-neon-200'
                        : 'text-gray-200',
                    ].join(' ')}
                  >
                    {date.getDate()}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Person rows */}
          {groupMembers.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
              No members in this group yet.
            </div>
          ) : (
            groupMembers.map((m) => {
              const memberColor = memberColorById.get(m.user_id) || m.color;
              return (
                <div
                  key={`pweekrow-${m.user_id}`}
                  className="grid border-t border-dark-200"
                  style={{ gridTemplateColumns: '160px repeat(7, minmax(0, 1fr))' }}
                >
                  <div className="px-3 py-2 flex items-center gap-2 bg-dark-100/60 border-r border-dark-300">
                    <span
                      aria-hidden="true"
                      className="inline-block w-3 h-3 rounded-sm border border-white/10 shrink-0"
                      style={{ backgroundColor: memberColor }}
                    />
                    <span className="text-sm font-medium text-gray-200 truncate">
                      {m.user_id === user?.id ? `${m.username} (you)` : m.username}
                    </span>
                  </div>
                  {weekDates.map((date) => {
                    const dayStart = startOfDay(date).getTime();
                    const dayEnd = addDays(startOfDay(date), 1).getTime();
                    // Events rendered as colored chips on THIS member's row:
                    // anything they created or RSVP'd going/maybe to within
                    // the selected group (and current visible range).
                    const coloredForMember =
                      visibleColoredIdsByMember.get(m.user_id) || null;
                    const dayEvents = eventsInRange.filter((ev) => {
                      if (!coloredForMember || !coloredForMember.has(ev.id)) return false;
                      const s = new Date(ev.start_time).getTime();
                      const en = new Date(ev.end_time).getTime();
                      return en > dayStart && s < dayEnd;
                    });
                    // Grey busy entries for this member, scoped to this day
                    // and excluding events already rendered as a colored
                    // chip on THIS member's row so we don't double-render.
                    const busyForMember = (busyByUser.get(m.user_id) || []).filter((b) => {
                      if (coloredForMember && coloredForMember.has(b.id)) return false;
                      const s = new Date(b.start_time).getTime();
                      const en = new Date(b.end_time).getTime();
                      return en > dayStart && s < dayEnd;
                    });
                    // Tag both lists so a single sort keeps them interleaved
                    // in chronological order (per the plan: "Sort all chips
                    // in the cell by start time so grey and colored intermix").
                    const cellItems = [
                      ...dayEvents.map((ev) => ({ kind: 'event', item: ev, startMs: new Date(ev.start_time).getTime() })),
                      ...busyForMember.map((b) => ({ kind: 'busy', item: b, startMs: new Date(b.start_time).getTime() })),
                    ].sort((a, b) => a.startMs - b.startMs);
                    return (
                      <div
                        key={`pweekcell-${m.user_id}-${ymdLocal(date)}`}
                        className="border-l border-dark-200 bg-dark-50 p-1 min-h-[64px] flex flex-col gap-1"
                      >
                        {cellItems.length === 0 ? (
                          <span className="m-auto text-[10px] uppercase tracking-wide text-gray-600">
                            free
                          </span>
                        ) : (
                          cellItems.map(({ kind, item }) => {
                            if (kind === 'busy') {
                              return (
                                <BusyBlock
                                  key={`b-${item.id}`}
                                  start={item.start_time}
                                  end={item.end_time}
                                  layout="chip"
                                />
                              );
                            }
                            const ev = item;
                            return (
                              <button
                                key={ev.id}
                                type="button"
                                onClick={() => openEventDetail(ev)}
                                className={`w-full truncate text-left rounded px-1.5 py-0.5 text-[11px] leading-tight transition-opacity hover:opacity-90${isTentativeEvent(ev) ? ' event-tentative' : ''}`}
                                style={getEventTheme(ev)}
                                title={`${ev.title} · ${hmLocal(ev.start_time)}–${hmLocal(ev.end_time)}`}
                              >
                                <span className="opacity-90 mr-1">{hmLocal(ev.start_time)}</span>
                                <span className="font-semibold">{ev.title}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Day view ───────────────────────────────────────────────── */}
      {view === 'day' && !(mode === 'people' && selectedGroupId !== 'all') && (
        <div className="border border-dark-300 rounded-lg overflow-hidden">
          <div className="grid" style={{ gridTemplateColumns: '64px 1fr' }}>
            <div className="bg-dark-100 border-b border-dark-300" />
            <div className="bg-dark-100 border-b border-dark-300 py-2 text-center">
              <div className="text-xs font-semibold text-gray-500">
                {(selectedDate ?? currentDate).toLocaleDateString('en-US', { weekday: 'long' })}
              </div>
              <div className="mt-1 text-sm font-bold text-gray-200">
                {(selectedDate ?? currentDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="grid" style={{ gridTemplateColumns: '64px 1fr' }}>
              {Array.from({ length: visibleHourCount }, (_, i) => {
                const hour = visibleHours.start + i;
                return (
                  <div key={`day-hour-${hour}`} className="contents">
                    <div className="relative border-b border-dark-200 bg-dark-100">
                      <div className="absolute -top-2 right-2 text-[10px] text-gray-600">
                        {i === 0 ? '' : `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 || hour === 24 ? 'AM' : 'PM'}`}
                      </div>
                      <div className="h-12" />
                    </div>
                    <div className="border-b border-dark-200 border-l border-dark-200 bg-dark-50 h-12" />
                  </div>
                );
              })}
            </div>

            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: '64px 1fr' }}>
              <div className="pointer-events-none" />
              <div className="relative" style={{ height: visibleHourCount * 48 }}>
                {(() => {
                  const focusDate = selectedDate ?? currentDate;
                  const dayStartMs = startOfDay(focusDate).getTime();
                  const dayEndMs = addDays(startOfDay(focusDate), 1).getTime();
                  const dayEvs = eventsForDay(focusDate);
                  const timeLayouts = getDayEventTimeLayouts(dayEvs);
                  const totalHeight = visibleHourCount * 48;

                  const earlier = [];
                  const later = [];
                  const overlapping = [];
                  for (const ev of dayEvs) {
                    const s = new Date(ev.start_time).getTime();
                    const e = new Date(ev.end_time).getTime();
                    const startInDay = s < dayStartMs ? 0 : minutesIntoDay(new Date(s));
                    const endInDay = e >= dayEndMs ? 1440 : minutesIntoDay(new Date(e));
                    if (endInDay <= visibleStartMin) earlier.push(ev);
                    else if (startInDay >= visibleEndMin) later.push(ev);
                    else overlapping.push(ev);
                  }

                  return (
                    <>
                      {overlapping.map((ev) => {
                        const s = new Date(ev.start_time);
                        const e = new Date(ev.end_time);
                        const startInDay = s.getTime() < dayStartMs ? 0 : minutesIntoDay(s);
                        const endInDay = e.getTime() >= dayEndMs ? 1440 : minutesIntoDay(e);
                        const clampedStart = Math.max(startInDay, visibleStartMin);
                        const clampedEnd = Math.min(endInDay, visibleEndMin);
                        const top = ((clampedStart - visibleStartMin) / visibleWindowMin) * totalHeight;
                        const height = clamp(
                          ((clampedEnd - clampedStart) / visibleWindowMin) * totalHeight,
                          18,
                          totalHeight - top
                        );
                        const h = timeLayouts.get(ev.id) || { leftPct: 0, widthPct: 100 };
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => openEventDetail(ev)}
                            className={`absolute rounded-md text-xs px-1.5 py-0.5 shadow pointer-events-auto cursor-pointer overflow-hidden transition-opacity hover:opacity-90${isTentativeEvent(ev) ? ' event-tentative' : ''}`}
                            style={{
                              top,
                              height,
                              left: `calc(${h.leftPct}% + 4px)`,
                              width: `calc(${h.widthPct}% - 8px)`,
                              right: 'auto',
                              ...getEventTheme(ev),
                            }}
                            title={`${ev.title} · ${hmLocal(s)}–${hmLocal(e)}`}
                          >
                            <div className="font-semibold truncate">{ev.title}</div>
                            <div className="opacity-90 truncate">{hmLocal(s)}–{hmLocal(e)}</div>
                          </button>
                        );
                      })}

                      {earlier.length > 0 && (
                        <div className="absolute top-1 left-1/2 -translate-x-1/2">
                          <OverflowPill
                            events={earlier}
                            direction="earlier"
                            menuAlign="below"
                            onEventClick={openEventDetail}
                          />
                        </div>
                      )}
                      {later.length > 0 && (
                        <div className="absolute bottom-1 left-1/2 -translate-x-1/2">
                          <OverflowPill
                            events={later}
                            direction="later"
                            menuAlign="above"
                            onEventClick={openEventDetail}
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Day view (People mode): rows = people, x-axis = hours ───── */}
      {view === 'day' && mode === 'people' && selectedGroupId !== 'all' && (() => {
        const focusDate = selectedDate ?? currentDate;
        const dayStartMs = startOfDay(focusDate).getTime();
        const dayEndMs = addDays(startOfDay(focusDate), 1).getTime();
        return (
          <div className="border border-dark-300 rounded-lg overflow-hidden">
            <div
              className="grid bg-dark-100"
              style={{ gridTemplateColumns: '160px 1fr' }}
            >
              <div className="px-3 py-2 border-b border-dark-300 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Person
              </div>
              <div className="border-b border-l border-dark-300 relative h-9">
                {Array.from({ length: visibleHourCount }, (_, i) => {
                  const hour = visibleHours.start + i;
                  return (
                    <div
                      key={`pdh-${hour}`}
                      className="absolute top-0 bottom-0 border-l border-dark-200 text-[10px] text-gray-500"
                      style={{
                        left: `${(i / visibleHourCount) * 100}%`,
                        width: `${100 / visibleHourCount}%`,
                      }}
                    >
                      <span className="absolute top-1 left-1 whitespace-nowrap">
                        {i === 0
                          ? ''
                          : `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 || hour === 24 ? 'a' : 'p'}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {groupMembers.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500">
                No members in this group yet.
              </div>
            ) : (
              groupMembers.map((m) => {
                const memberColor = memberColorById.get(m.user_id) || m.color;
                // Events rendered as colored bars on THIS member's row:
                // anything they created or RSVP'd going/maybe to within the
                // selected group (and current visible range).
                const coloredForMember =
                  visibleColoredIdsByMember.get(m.user_id) || null;
                const memberEventsAll = eventsInRange
                  .filter((ev) => {
                    if (!coloredForMember || !coloredForMember.has(ev.id)) return false;
                    const s = new Date(ev.start_time).getTime();
                    const en = new Date(ev.end_time).getTime();
                    return en > dayStartMs && s < dayEndMs;
                  })
                  .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

                // Grey busy entries for this member on this day, excluding
                // events already rendered as a colored bar on THIS member's
                // row so we don't double-render.
                const memberBusyAll = (busyByUser.get(m.user_id) || []).filter((b) => {
                  if (coloredForMember && coloredForMember.has(b.id)) return false;
                  const s = new Date(b.start_time).getTime();
                  const en = new Date(b.end_time).getTime();
                  return en > dayStartMs && s < dayEndMs;
                });

                // Partition into earlier / later / overlapping-window buckets
                // so events outside the visible range become pills rather than
                // getting squished off-screen.
                const earlier = [];
                const later = [];
                const overlapping = [];
                for (const ev of memberEventsAll) {
                  const s = new Date(ev.start_time).getTime();
                  const e = new Date(ev.end_time).getTime();
                  const startInDay = s < dayStartMs ? 0 : minutesIntoDay(new Date(s));
                  const endInDay = e >= dayEndMs ? 1440 : minutesIntoDay(new Date(e));
                  if (endInDay <= visibleStartMin) earlier.push(ev);
                  else if (startInDay >= visibleEndMin) later.push(ev);
                  else overlapping.push(ev);
                }
                // Same partitioning for busy entries. Busy bars render inside
                // the visible window; overflow pills also count busy entries
                // so the total count accurately reflects "how many things are
                // hidden to the earlier/later side" for this person.
                const busyOverlapping = [];
                for (const b of memberBusyAll) {
                  const s = new Date(b.start_time).getTime();
                  const e = new Date(b.end_time).getTime();
                  const startInDay = s < dayStartMs ? 0 : minutesIntoDay(new Date(s));
                  const endInDay = e >= dayEndMs ? 1440 : minutesIntoDay(new Date(e));
                  if (endInDay <= visibleStartMin) earlier.push(b);
                  else if (startInDay >= visibleEndMin) later.push(b);
                  else busyOverlapping.push(b);
                }
                // Keep overflow pills sorted chronologically regardless of
                // whether entries are colored events or grey busy blocks.
                earlier.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
                later.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
                return (
                  <div
                    key={`pdayrow-${m.user_id}`}
                    className="grid border-t border-dark-200"
                    style={{ gridTemplateColumns: '160px 1fr' }}
                  >
                    <div className="px-3 py-2 flex items-center gap-2 bg-dark-100/60 border-r border-dark-300">
                      <span
                        aria-hidden="true"
                        className="inline-block w-3 h-3 rounded-sm border border-white/10 shrink-0"
                        style={{ backgroundColor: memberColor }}
                      />
                      <span className="text-sm font-medium text-gray-200 truncate">
                        {m.user_id === user?.id ? `${m.username} (you)` : m.username}
                      </span>
                    </div>
                    <div className="relative h-12 border-l border-dark-200 bg-dark-50">
                      {/* Hour grid lines */}
                      {Array.from({ length: visibleHourCount }, (_, i) => (
                        <div
                          key={`pdaygrid-${m.user_id}-${i}`}
                          aria-hidden="true"
                          className="absolute top-0 bottom-0 border-l border-dark-200"
                          style={{ left: `${(i / visibleHourCount) * 100}%` }}
                        />
                      ))}
                      {/* Grey busy bars render first so colored group
                          events can visually stack on top if they share
                          a window. */}
                      {busyOverlapping.map((b) => {
                        const s = new Date(b.start_time);
                        const e = new Date(b.end_time);
                        const startMin = clamp(
                          s.getTime() < dayStartMs ? 0 : minutesIntoDay(s),
                          0,
                          1440
                        );
                        const endMin = clamp(
                          e.getTime() >= dayEndMs ? 1440 : minutesIntoDay(e),
                          startMin + 5,
                          1440
                        );
                        const clampedStart = Math.max(startMin, visibleStartMin);
                        const clampedEnd = Math.min(endMin, visibleEndMin);
                        const left = ((clampedStart - visibleStartMin) / visibleWindowMin) * 100;
                        const width = ((clampedEnd - clampedStart) / visibleWindowMin) * 100;
                        return (
                          <div
                            key={`busy-${b.id}`}
                            className="absolute top-1 bottom-1"
                            style={{
                              left: `${left}%`,
                              width: `${Math.max(width, 0.5)}%`,
                            }}
                          >
                            <BusyBlock
                              start={b.start_time}
                              end={b.end_time}
                              layout="bar"
                            />
                          </div>
                        );
                      })}
                      {overlapping.map((ev) => {
                        const s = new Date(ev.start_time);
                        const e = new Date(ev.end_time);
                        const startMin = clamp(
                          s.getTime() < dayStartMs ? 0 : minutesIntoDay(s),
                          0,
                          1440
                        );
                        const endMin = clamp(
                          e.getTime() >= dayEndMs ? 1440 : minutesIntoDay(e),
                          startMin + 5,
                          1440
                        );
                        const clampedStart = Math.max(startMin, visibleStartMin);
                        const clampedEnd = Math.min(endMin, visibleEndMin);
                        const left = ((clampedStart - visibleStartMin) / visibleWindowMin) * 100;
                        const width = ((clampedEnd - clampedStart) / visibleWindowMin) * 100;
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => openEventDetail(ev)}
                            className={`absolute top-1 bottom-1 rounded-md text-[10px] px-1.5 shadow overflow-hidden transition-opacity hover:opacity-90 text-left${isTentativeEvent(ev) ? ' event-tentative' : ''}`}
                            style={{
                              left: `${left}%`,
                              width: `${Math.max(width, 0.5)}%`,
                              ...getEventTheme(ev),
                            }}
                            title={`${ev.title} · ${hmLocal(s)}–${hmLocal(e)}`}
                          >
                            <span className="font-semibold truncate block">
                              {ev.title}
                            </span>
                          </button>
                        );
                      })}

                      {earlier.length > 0 && (
                        <div className="absolute top-1/2 left-1 -translate-y-1/2 z-10">
                          <OverflowPill
                            events={earlier}
                            direction="earlier"
                            menuAlign="right"
                            onEventClick={openEventDetail}
                          />
                        </div>
                      )}
                      {later.length > 0 && (
                        <div className="absolute top-1/2 right-1 -translate-y-1/2 z-10">
                          <OverflowPill
                            events={later}
                            direction="later"
                            menuAlign="left"
                            onEventClick={openEventDetail}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        );
      })()}

      {/* Selected Date Display */}
      {selectedDate && (
        <div className="mt-6 p-4 bg-dark-100 border border-dark-300 rounded-lg">
          <p className="text-sm text-gray-500">Selected Date:</p>
          <p className="text-lg font-semibold text-gray-200">
            {selectedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      )}

      {/* ── Create Event Modal ─────────────────────────────────────── */}
      {eventModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-5xl bg-dark-50 rounded-2xl shadow-2xl p-6 border border-dark-300 font-teams">
            <div className="flex items-start justify-between gap-4 mb-4">
              <h3 className="text-3xl font-bold text-gray-100">New Event</h3>
              <button
                type="button"
                onClick={() => setEventModalOpen(false)}
                className="btn-ghost text-gray-500 hover:text-gray-200 px-3 py-1"
                aria-label="Close"
              >
                X
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left column */}
              <div className="space-y-4">
                <div>
                  <label className="block text-lg font-bold text-gray-200 mb-1 tracking-tight">
                    Title <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="input-field text-lg"
                    placeholder="Pickleball 3v3"
                  />
                </div>

                <div>
                  <label className="block text-lg font-bold text-gray-200 mb-1 tracking-tight">Location</label>
                  <input
                    value={draftLocation}
                    onChange={(e) => setDraftLocation(e.target.value)}
                    className="input-field text-lg"
                    placeholder="Anderson Park, College Station"
                  />
                </div>

                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-lg font-bold text-gray-200 mb-1 tracking-tight">Start</label>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className="input-field" />
                        <input type="time" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} className="input-field" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-lg font-bold text-gray-200 mb-1 tracking-tight">End</label>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className="input-field" />
                        <input type="time" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} className="input-field" />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-lg font-bold text-gray-200 mb-1 tracking-tight">Details</label>
                  <div className="border border-dark-300 rounded-xl overflow-hidden shadow-sm shadow-black/10">
                    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-dark-300 bg-dark-200/50">
                      <button type="button" className="btn-ghost px-2.5 py-1 text-xs font-bold">B</button>
                      <button type="button" className="btn-ghost px-2.5 py-1 text-xs italic">I</button>
                      <button type="button" className="btn-ghost px-2.5 py-1 text-xs underline">U</button>
                    </div>
                    <textarea
                      value={draftDetails}
                      onChange={(e) => setDraftDetails(e.target.value)}
                      rows={5}
                      className="w-full px-4 py-3 bg-dark-100 text-lg text-gray-100 focus:outline-none resize-none placeholder-gray-600"
                      placeholder="We can rotate by king of the court..."
                    />
                  </div>
                </div>
              </div>

              {/* Right column */}
              <div className="space-y-4">
                <div>
                  <div className="text-lg font-bold text-gray-200 mb-1">Share with groups (optional)</div>
                  <p className="text-sm text-gray-500 mb-2">
                    {groups.length === 0
                      ? 'No groups yet — this will be a personal event only you see here.'
                      : 'Uncheck all groups to keep it personal (only you).'}
                  </p>
                  <div className="border border-dark-300 rounded-lg p-3 bg-dark-100 max-h-56 overflow-y-auto pr-2 space-y-2">
                    {groups.length === 0 ? (
                      <p className="text-gray-500 text-sm">You can still add calendar events for yourself.</p>
                    ) : (
                      groups.map((g) => {
                        const checked = draftGroups.includes(g.id);
                        return (
                          <label key={g.id} className="flex items-center justify-between gap-3 cursor-pointer select-none">
                            <span className="text-lg text-gray-200">{g.name}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? Array.from(new Set([...draftGroups, g.id]))
                                  : draftGroups.filter((x) => x !== g.id);
                                setDraftGroups(next);
                              }}
                              className="h-5 w-5 accent-neon"
                            />
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="pt-2">
                  <div className="text-lg font-bold text-gray-200">Organizer</div>
                  <div className="text-lg text-neon-200">{user?.username ?? 'Unknown'}</div>
                </div>

                {eventError && (
                  <div className="p-3 border border-red-500/40 rounded-md bg-red-500/10 text-red-400 text-base">
                    {eventError}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEventModalOpen(false)}
                    className="btn-secondary text-base px-6"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={createEvent}
                    disabled={saving}
                    className="btn-primary text-base px-6"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setViewingEvent(null)}>
          <div className="w-full max-w-md bg-dark-50 rounded-2xl shadow-2xl border border-dark-300 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div
              className={`px-6 py-4${isTentativeEvent(viewingEvent) ? ' event-tentative' : ''}`}
              style={getEventTheme(viewingEvent)}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold leading-snug" style={{ color: 'inherit' }}>{viewingEvent.title}</h3>
                  {!isMine(viewingEvent) && (
                    <span className="text-xs opacity-90">Someone else&apos;s event</span>
                  )}
                </div>
                <button type="button" onClick={() => setViewingEvent(null)} className="text-lg font-bold leading-none mt-0.5 opacity-80 hover:opacity-100" style={{ color: 'inherit' }} aria-label="Close">
                  ✕
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Date & time */}
              <div className="flex items-start gap-3 text-gray-300">
                <svg className="w-5 h-5 mt-0.5 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <div className="font-medium text-gray-200">
                    {new Date(viewingEvent.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div className="text-sm text-gray-400">
                    {hmLocal(viewingEvent.start_time)} – {hmLocal(viewingEvent.end_time)}
                  </div>
                </div>
              </div>

              {/* Location */}
              {viewingEvent.location && (
                <div className="flex items-start gap-3 text-gray-300">
                  <svg className="w-5 h-5 mt-0.5 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>{viewingEvent.location}</span>
                </div>
              )}

              {/* Groups / personal */}
              {(!viewingEvent.event_groups || viewingEvent.event_groups.length === 0) && isMine(viewingEvent) ? (
                <div className="flex items-start gap-3 text-gray-300">
                  <svg className="w-5 h-5 mt-0.5 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span>Personal event (not shared with a group)</span>
                </div>
              ) : viewingEvent.event_groups?.length > 0 ? (
                <div className="flex items-start gap-3 text-gray-300">
                  <svg className="w-5 h-5 mt-0.5 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <span>
                    {viewingEvent.event_groups
                      .map((eg) => eg.groups?.name ?? groups.find((g) => g.id === eg.group_id)?.name ?? 'Unknown group')
                      .join(', ')}
                  </span>
                </div>
              ) : null}

              {/* Details */}
              {viewingEvent.details && (
                <div className="p-3 bg-dark-100 border border-dark-300 rounded-lg text-gray-300 text-sm whitespace-pre-wrap">
                  {viewingEvent.details}
                </div>
              )}

              {/* RSVP lists + actions — only for events shared with at least one group */}
              {!isPersonalEvent(viewingEvent) && (
                <>
                  {/* Who responded */}
                  {(() => {
                    const byStatus = getRsvpNamesByStatus(viewingEvent);
                    const block = (label, emoji, names, colorClass) => (
                      <div className="rounded-lg border border-dark-300 overflow-hidden">
                        <div className={`px-3 py-2 text-xs font-semibold ${colorClass} flex items-center justify-between`}>
                          <span>{emoji} {label}</span>
                          <span className="text-gray-500 font-normal">({names.length})</span>
                        </div>
                        <ul className="px-3 py-2 text-sm text-gray-300 max-h-32 overflow-y-auto space-y-0.5">
                          {names.length === 0 ? (
                            <li className="text-gray-600 text-xs italic">No one yet</li>
                          ) : (
                            names.map((name, idx) => (
                              <li key={`${label}-${idx}-${name}`} className="truncate">{name}</li>
                            ))
                          )}
                        </ul>
                      </div>
                    );
                    return (
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-gray-400">Who&apos;s down?</div>
                        <div className="grid gap-2 sm:grid-cols-1">
                          {block('Going', '🤙', byStatus.going, 'bg-green-500/10 text-green-400 border-b border-green-500/20')}
                          {block('Maybe', '🤔', byStatus.maybe, 'bg-amber-500/10 text-amber-400 border-b border-amber-500/20')}
                          {block("Can't go", '😔', byStatus.notgoing, 'bg-red-500/10 text-red-400 border-b border-red-500/20')}
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Are you down?</div>
                    <div className="flex gap-2">
                      {[
                        { key: 'going', label: "I'm Down!", activeClass: 'bg-neon text-dark border-neon shadow-md shadow-neon/20', icon: '🤙' },
                        { key: 'maybe', label: 'Maybe', activeClass: 'bg-yellow-500 text-dark border-yellow-500 shadow-md shadow-yellow-500/20', icon: '🤔' },
                        { key: 'notgoing', label: "Can't Make It", activeClass: 'bg-red-500 text-white border-red-500 shadow-md shadow-red-500/20', icon: '😔' },
                      ].map(({ key, label, activeClass, icon }) => {
                        const isActive = getUserRsvp(viewingEvent) === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => updateEventRsvp(viewingEvent.id, key)}
                            className={[
                              'flex-1 py-2.5 px-2 rounded-xl border-2 text-sm font-semibold tracking-tight transition-all duration-150 text-center active:scale-[0.97]',
                              isActive ? activeClass : 'border-dark-400 text-gray-400 hover:border-gray-500 hover:text-gray-300',
                            ].join(' ')}
                          >
                            <span className="block text-base mb-0.5">{icon}</span>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Footer actions */}
              <div className="flex justify-end pt-2 border-t border-dark-300">
                {isMine(viewingEvent) ? (
                  <button
                    type="button"
                    onClick={() => { deleteEvent(viewingEvent.id); setViewingEvent(null); }}
                    className="btn-danger text-sm"
                  >
                    Delete Event
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      hideEventFromMyCalendar(viewingEvent.id);
                      setViewingEvent(null);
                    }}
                    className="btn-danger text-sm"
                    title="Hide this event from your calendar. The organizer and other invitees will still see it."
                  >
                    Remove from My Calendar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Calendar;
