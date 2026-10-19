CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  personal_id TEXT NOT NULL UNIQUE,
  password_salt TEXT,
  password_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  owner_uid TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  pills_per_pack INTEGER NOT NULL CHECK (pills_per_pack BETWEEN 1 AND 42),
  pills_taken INTEGER NOT NULL CHECK (pills_taken BETWEEN 0 AND pills_per_pack),
  reminder_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  last_taken_date TEXT,
  last_reminder_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  subscriber_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  owner_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (subscriber_uid, owner_uid)
);
CREATE INDEX IF NOT EXISTS subscriptions_by_owner ON subscriptions(owner_uid);

CREATE TABLE IF NOT EXISTS devices (
  token_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  token TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_by_uid ON devices(uid);
