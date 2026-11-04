-- Notes saved with memo_write. n gives the newest-first order.
CREATE TABLE memos (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL
);

-- Files saved with upload. Bytes live in file_chunks, at most 1 MiB per row.
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  client_id TEXT NOT NULL
);
CREATE TABLE file_chunks (
  file_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (file_id, idx)
);

-- OAuth: clients from dynamic registration, cached client metadata documents,
-- pending consent screens, authorization codes and tokens (only hashes are kept).
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE cimd_cache (
  url TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  exp INTEGER NOT NULL
);
CREATE TABLE grants (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  exp INTEGER NOT NULL
);
CREATE INDEX grants_exp ON grants (exp);
CREATE TABLE login_fails (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  exp INTEGER NOT NULL
);
