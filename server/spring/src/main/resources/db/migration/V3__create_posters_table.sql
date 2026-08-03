CREATE TABLE IF NOT EXISTS posters (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type VARCHAR(30) NOT NULL,
  classification_confidence NUMERIC(4, 3),
  title VARCHAR(255),
  organizer_name VARCHAR(150),
  event_start_date DATE,
  event_end_date DATE,
  contact_phone VARCHAR(50),
  contact_email VARCHAR(150),
  location VARCHAR(255),
  fee VARCHAR(100),
  website_url TEXT,
  description TEXT,
  raw_text TEXT,
  parsed_json JSONB,
  raw_json JSONB,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posters_user_id ON posters(user_id);
CREATE INDEX IF NOT EXISTS idx_posters_title_trgm ON posters USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_posters_organizer_name_trgm ON posters USING GIN (organizer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_posters_location_trgm ON posters USING GIN (location gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_posters_contact_phone_trgm ON posters USING GIN (contact_phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_posters_contact_email_trgm ON posters USING GIN (contact_email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_posters_raw_text_trgm ON posters USING GIN (raw_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_posters_embedding_hnsw ON posters USING hnsw (embedding vector_cosine_ops);
