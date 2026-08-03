CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_business_cards_name_trgm ON business_cards USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_business_cards_company_trgm ON business_cards USING GIN (company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_business_cards_position_trgm ON business_cards USING GIN (position gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_business_cards_phone_trgm ON business_cards USING GIN (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_business_cards_email_trgm ON business_cards USING GIN (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_business_cards_raw_ocr_text_trgm ON business_cards USING GIN (raw_ocr_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_business_cards_embedding_hnsw ON business_cards USING hnsw (embedding vector_cosine_ops);
