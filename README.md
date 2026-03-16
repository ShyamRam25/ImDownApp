# ImDown

Scheduling app for group hangouts. Built with React 19 + Vite + Tailwind CSS + Supabase.

## Getting Started

```bash
cd imdown
npm install
npm run dev
```

Create a `.env` file in `imdown/` with your credentials:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id
VITE_GOOGLE_API_KEY=your-google-api-key
```

---

## Google Calendar Import Setup (Manual Steps)

To enable the "Import Google Cal" feature, you need a Google Cloud project with the Calendar API enabled and OAuth credentials.

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)

### 2. Enable the Google Calendar API

1. In the Cloud Console, go to **APIs & Services > Library**
2. Search for "Google Calendar API" and click **Enable**

### 3. Configure the OAuth Consent Screen

1. Go to **Google Auth platform > Branding** ([direct link](https://console.cloud.google.com/auth/branding))
2. If prompted, click **Get Started** and fill in:
   - **App name**: ImDown
   - **User support email**: your email
   - **Audience**: Internal (for testing) or External (for production -- requires verification)
3. Go to **Data Access** and add the scope: `https://www.googleapis.com/auth/calendar.readonly`
4. If using External audience, add your Google account as a **test user** under **Audience**

### 4. Create OAuth 2.0 Client ID

1. Go to **Google Auth platform > Clients** ([direct link](https://console.cloud.google.com/auth/clients))
2. Click **Create Client**
3. Select **Web application**
4. Under **Authorized JavaScript origins**, add:
   - `http://localhost:5173` (Vite dev server)
   - Your production domain if applicable
5. Click **Create** and copy the **Client ID**
6. Paste it as `VITE_GOOGLE_CLIENT_ID` in your `.env` file

### 5. Create an API Key

1. Go to **APIs & Services > Credentials** ([direct link](https://console.cloud.google.com/apis/credentials))
2. Click **Create credentials > API key**
3. (Recommended) Click the key, then **Restrict key**:
   - Under **Application restrictions**, select **HTTP referrers** and add `http://localhost:5173/*`
   - Under **API restrictions**, select **Restrict key** and choose **Google Calendar API**
4. Copy the API key and paste it as `VITE_GOOGLE_API_KEY` in your `.env` file

---

## Supabase Setup (Manual Steps)

Once your Supabase project is unpaused, open the **SQL Editor** in the Supabase dashboard and run the following sections in order.

### 1. Update the `users` table

The existing `users` table needs new columns for Google OAuth login and a unique constraint on `username`.
The `password` column is made nullable so Google-authenticated users don't need one.

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_id text UNIQUE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url text;

ALTER TABLE users
  ALTER COLUMN password DROP NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_username_unique UNIQUE (username);
```

### 2. Create the `groups` table

```sql
CREATE TABLE groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
```

### 3. Create the `group_members` table

```sql
CREATE TABLE group_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE (group_id, user_id)
);
```

### 4. Create the `events` table

```sql
CREATE TABLE events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  location   text DEFAULT '',
  details    text DEFAULT '',
  start_time timestamptz NOT NULL,
  end_time   timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  CHECK (end_time > start_time)
);
```

### 5. Create the `event_groups` junction table

```sql
CREATE TABLE event_groups (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  UNIQUE (event_id, group_id)
);
```

### 6. Create the `event_rsvps` table

```sql
CREATE TABLE event_rsvps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL CHECK (status IN ('going', 'maybe', 'notgoing')),
  responded_at timestamptz DEFAULT now(),
  UNIQUE (event_id, user_id)
);
```

### 7. Create indexes

```sql
CREATE INDEX idx_group_members_user   ON group_members(user_id);
CREATE INDEX idx_group_members_group  ON group_members(group_id);
CREATE INDEX idx_event_groups_event   ON event_groups(event_id);
CREATE INDEX idx_event_groups_group   ON event_groups(group_id);
CREATE INDEX idx_events_created_by    ON events(created_by);
CREATE INDEX idx_events_time_range    ON events(start_time, end_time);
CREATE INDEX idx_event_rsvps_event    ON event_rsvps(event_id);
CREATE INDEX idx_event_rsvps_user     ON event_rsvps(user_id);
```

### 8. Seed the default groups

```sql
INSERT INTO groups (name) VALUES
  ('CSCW classmates'),
  ('soccer teammates'),
  ('capstone group'),
  ('home town friends');
```

### 9. RLS (optional, for production)

Row Level Security is currently **disabled** (the app uses custom auth, not Supabase Auth).
If you switch to Supabase Auth later, enable RLS on each table and add policies so that:

- Users can only read groups they belong to
- Users can only see events shared with their groups
- Users can only create/update/delete their own events
- Users can only write their own RSVP rows

---

## Database Schema

```
users
  id          uuid PK
  username    text UNIQUE
  password    text (nullable, not needed for Google login)
  google_id   text UNIQUE (nullable, set for Google-authenticated users)
  email       text (nullable)
  avatar_url  text (nullable)
  created_at  timestamptz

groups
  id          uuid PK
  name        text
  created_by  uuid FK → users
  created_at  timestamptz

group_members
  id          uuid PK
  group_id    uuid FK → groups
  user_id     uuid FK → users
  role        text ('admin' | 'member')
  joined_at   timestamptz

events
  id          uuid PK
  created_by  uuid FK → users
  title       text
  location    text
  details     text
  start_time  timestamptz
  end_time    timestamptz
  created_at  timestamptz

event_groups
  id          uuid PK
  event_id    uuid FK → events
  group_id    uuid FK → groups

event_rsvps
  id          uuid PK
  event_id    uuid FK → events
  user_id     uuid FK → users
  status      text ('going' | 'maybe' | 'notgoing')
  responded_at timestamptz
```
