-- A change hint for the owner's open devices. No user text or activity counts.
CREATE TABLE sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version TEXT NOT NULL
);
INSERT INTO sync_state (id, version) VALUES (1, lower(hex(randomblob(16))));
