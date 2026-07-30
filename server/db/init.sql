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

CREATE INDEX IF NOT EXISTS idx_cards_user_id ON business_cards(user_id);
