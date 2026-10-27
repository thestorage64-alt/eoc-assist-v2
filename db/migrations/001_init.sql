BEGIN;

CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  designation text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  global_role text NOT NULL CHECK (global_role IN ('principal','chair','head','member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at bigint NOT NULL
);

CREATE TABLE auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at bigint NOT NULL,
  last_seen_at bigint NOT NULL,
  revoked_at bigint
);

CREATE TABLE cells (
  id text PRIMARY KEY,
  number integer NOT NULL UNIQUE,
  name text NOT NULL,
  mandate text NOT NULL DEFAULT ''
);

CREATE TABLE memberships (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cell_id text NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('head','member')),
  created_at bigint NOT NULL,
  UNIQUE (user_id, cell_id)
);

CREATE TABLE circulars (
  id text PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  received_at bigint NOT NULL,
  due_at bigint,
  state text NOT NULL DEFAULT 'intake'
    CHECK (state IN ('intake','route','convene','pre_meeting','meeting','implement','verify','report','done')),
  cell_id text REFERENCES cells(id),
  assigned_to text REFERENCES users(id),
  created_by text NOT NULL REFERENCES users(id),
  confidential boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE classifications (
  circular_id text PRIMARY KEY REFERENCES circulars(id) ON DELETE CASCADE,
  suggestion jsonb,
  final jsonb,
  verdict text CHECK (verdict IN ('confirmed','corrected')),
  decided_by text REFERENCES users(id),
  decided_at bigint,
  CONSTRAINT verdict_needs_final CHECK (verdict IS NULL OR final IS NOT NULL)
);

CREATE TABLE meetings (
  id text PRIMARY KEY,
  circular_id text NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
  held_at bigint NOT NULL,
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','held','signed')),
  minutes_md text,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  signed_by text REFERENCES users(id),
  signed_at bigint,
  created_at bigint NOT NULL
);

CREATE TABLE actions (
  id text PRIMARY KEY,
  circular_id text NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
  meeting_id text REFERENCES meetings(id) ON DELETE SET NULL,
  title text NOT NULL,
  owner_id text REFERENCES users(id),
  due_at bigint,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  completed_at bigint,
  created_at bigint NOT NULL
);

CREATE TABLE documents (
  id text PRIMARY KEY,
  circular_id text NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
  kind text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  content_md text NOT NULL,
  created_by text REFERENCES users(id),
  approved_by text REFERENCES users(id),
  approved_at bigint,
  created_at bigint NOT NULL,
  UNIQUE (circular_id, kind, version)
);

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  actor_id text REFERENCES users(id),
  action text NOT NULL,
  entity_type text,
  entity_id text,
  cell_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at bigint NOT NULL
);

CREATE INDEX idx_circulars_state ON circulars(state);
CREATE INDEX idx_circulars_cell_id ON circulars(cell_id);
CREATE INDEX idx_circulars_due_at ON circulars(due_at);
CREATE INDEX idx_actions_circular_id ON actions(circular_id);
CREATE INDEX idx_actions_owner_status ON actions(owner_id, status);
CREATE INDEX idx_audit_events_entity ON audit_events(entity_type, entity_id);
CREATE INDEX idx_audit_events_at ON audit_events(at);

INSERT INTO cells (id, number, name) VALUES
('cell_01', 1, 'SC/ST Cell'),
('cell_02', 2, 'OBC Cell'),
('cell_03', 3, 'Women''s Cell'),
('cell_04', 4, 'Minority Cell'),
('cell_05', 5, 'Differently Abled Cell'),
('cell_06', 6, 'International Students Cell'),
('cell_07', 7, 'Counselling and Mentoring Cell'),
('cell_08', 8, 'Gender Sensitization Cell'),
('cell_09', 9, 'Prevention of Sexual Harassment Cell'),
('cell_10', 10, 'National Service Scheme Cell'),
('cell_11', 11, 'Human Studies Cell'),
('cell_12', 12, 'Population Studies Cell'),
('cell_13', 13, 'Remedial Coaching Cell'),
('cell_14', 14, 'Women''s Study Cell')
ON CONFLICT (id) DO NOTHING;

COMMIT;
