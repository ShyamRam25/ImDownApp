import { useCallback, useEffect, useRef, useState } from 'react';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY ?? '';

export default function useGoogleCalendar() {
  const [ready, setReady] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState(null);
  const tokenClientRef = useRef(null);
  const gapiInitedRef = useRef(false);
  const gisInitedRef = useRef(false);

  const checkReady = useCallback(() => {
    if (gapiInitedRef.current && gisInitedRef.current) setReady(true);
  }, []);

  useEffect(() => {
    if (!CLIENT_ID || !API_KEY) {
      setError('Missing VITE_GOOGLE_CLIENT_ID or VITE_GOOGLE_API_KEY in .env');
      return;
    }

    let cancelled = false;

    const initGapi = async () => {
      if (typeof window.gapi === 'undefined') return;
      await new Promise((resolve) => window.gapi.load('client', resolve));
      await window.gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: [DISCOVERY_DOC],
      });
      if (!cancelled) {
        gapiInitedRef.current = true;
        checkReady();
      }
    };

    const initGis = () => {
      if (typeof window.google?.accounts?.oauth2 === 'undefined') return;
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '',
      });
      gisInitedRef.current = true;
      checkReady();
    };

    const waitForScripts = () => {
      const interval = setInterval(() => {
        if (cancelled) { clearInterval(interval); return; }
        if (window.gapi && !gapiInitedRef.current) initGapi();
        if (window.google?.accounts?.oauth2 && !gisInitedRef.current) initGis();
        if (gapiInitedRef.current && gisInitedRef.current) clearInterval(interval);
      }, 200);
    };

    waitForScripts();
    return () => { cancelled = true; };
  }, [checkReady]);

  const authorize = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (!tokenClientRef.current) {
        reject(new Error('Google Identity Services not initialized'));
        return;
      }

      tokenClientRef.current.callback = (resp) => {
        if (resp.error) {
          setAuthorized(false);
          reject(new Error(resp.error));
          return;
        }
        setAuthorized(true);
        resolve(resp);
      };

      tokenClientRef.current.error_callback = (err) => {
        reject(new Error(err.type || 'Authorization failed'));
      };

      const token = window.gapi.client.getToken();
      if (token === null) {
        tokenClientRef.current.requestAccessToken({ prompt: 'consent' });
      } else {
        tokenClientRef.current.requestAccessToken({ prompt: '' });
      }
    });
  }, []);

  const revokeAccess = useCallback(() => {
    const token = window.gapi.client.getToken();
    if (token) {
      window.google.accounts.oauth2.revoke(token.access_token);
      window.gapi.client.setToken('');
    }
    setAuthorized(false);
  }, []);

  const fetchEvents = useCallback(async ({ timeMin, timeMax, maxResults = 250 } = {}) => {
    const now = new Date();
    const defaultMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const defaultMax = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString();

    const response = await window.gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin || defaultMin,
      timeMax: timeMax || defaultMax,
      showDeleted: false,
      singleEvents: true,
      maxResults,
      orderBy: 'startTime',
    });

    return (response.result.items || []).map((item) => ({
      googleId: item.id,
      title: item.summary || '(No title)',
      location: item.location || '',
      details: item.description || '',
      start: item.start.dateTime || item.start.date,
      end: item.end.dateTime || item.end.date,
      isAllDay: !item.start.dateTime,
    }));
  }, []);

  return { ready, authorized, error, authorize, revokeAccess, fetchEvents };
}
