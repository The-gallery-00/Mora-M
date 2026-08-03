CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type VARCHAR(30) NOT NULL,
  classification_confidence NUMERIC(4, 3),
  transport_type VARCHAR(50),
  departure_location VARCHAR(255),
  departure_date DATE,
  departure_time TIME,
  arrival_location VARCHAR(255),
  arrival_date DATE,
  arrival_time TIME,
  raw_text TEXT,
  parsed_json JSONB,
  raw_json JSONB,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_departure_location_trgm ON tickets USING GIN (departure_location gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_arrival_location_trgm ON tickets USING GIN (arrival_location gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_transport_type_trgm ON tickets USING GIN (transport_type gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_raw_text_trgm ON tickets USING GIN (raw_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_embedding_hnsw ON tickets USING hnsw (embedding vector_cosine_ops);
