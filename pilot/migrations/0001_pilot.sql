PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT UNIQUE NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY REFERENCES invites(id),
  consent INTEGER NOT NULL DEFAULT 0 CHECK(consent IN (0,1)),
  consent_version TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  participant_id TEXT REFERENCES participants(id),
  role TEXT NOT NULL CHECK(role IN ('tester','admin')),
  expires_at INTEGER NOT NULL,
  CHECK((role='tester' AND participant_id IS NOT NULL) OR (role='admin' AND participant_id IS NULL))
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
-- Operational admissions contain counts/identifiers only, never event details.
-- They survive consent withdrawal to prevent reset/reconsent limit bypass.
CREATE TABLE IF NOT EXISTS admissions (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('event','feedback','ai','login')),
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admissions_budget ON admissions(kind,day,participant_id);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_participant ON events(participant_id,created_at);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  accuracy TEXT NOT NULL,
  goal TEXT NOT NULL,
  outcome TEXT NOT NULL,
  comment TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_participant ON feedback(participant_id,created_at);
