CREATE TABLE reviews (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected','cancelled','expired','applied')),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 decided_at INTEGER, applied_at INTEGER, note_id TEXT, reason TEXT
);
CREATE INDEX reviews_state_time ON reviews(state,created_at);
CREATE TABLE notes (
 id TEXT PRIMARY KEY, review_id TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE audit (
 id INTEGER PRIMARY KEY, review_id TEXT NOT NULL,
 event TEXT NOT NULL, at INTEGER NOT NULL, detail TEXT NOT NULL
);
CREATE INDEX audit_review_id ON audit(review_id,id);
