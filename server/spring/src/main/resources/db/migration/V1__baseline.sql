CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(20) DEFAULT 'local',
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255),
  name VARCHAR(100) NOT NULL,
  picture TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(email, provider)
);

CREATE TABLE IF NOT EXISTS business_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID,
  name VARCHAR(100),
  company VARCHAR(200),
  position VARCHAR(100),
  phone VARCHAR(50),
  email VARCHAR(255),
  raw_ocr_text TEXT,
  image_url TEXT DEFAULT '',
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(60) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, name)
);

ALTER TABLE business_cards
  ADD COLUMN IF NOT EXISTS group_id UUID;

ALTER TABLE business_cards
  DROP CONSTRAINT IF EXISTS fk_business_cards_group;

ALTER TABLE business_cards
  ADD CONSTRAINT fk_business_cards_group
  FOREIGN KEY (group_id) REFERENCES card_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cards_user_id ON business_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_group_id ON business_cards(group_id);
CREATE INDEX IF NOT EXISTS idx_card_groups_user_id ON card_groups(user_id);

CREATE TABLE IF NOT EXISTS google_calendar_tokens (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_email VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  scope TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
