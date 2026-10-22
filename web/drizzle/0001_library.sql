CREATE TABLE library_files (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  uploader TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('music', 'script')),
  title TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  content_type TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX library_files_created ON library_files(created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX library_files_owner ON library_files(owner_id);
