CREATE TABLE IF NOT EXISTS notification_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  deadline_reminder_days INTEGER NOT NULL DEFAULT 3 CHECK (deadline_reminder_days BETWEEN 0 AND 30),
  deadline_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  schedule_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  link_url TEXT,
  source_type VARCHAR(30),
  source_id VARCHAR(64),
  target_date DATE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_source_target
  ON notifications(user_id, type, source_type, source_id, target_date)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND target_date IS NOT NULL;
