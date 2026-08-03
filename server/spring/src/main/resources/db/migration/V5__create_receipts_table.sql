CREATE TABLE IF NOT EXISTS receipts (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type VARCHAR(30) NOT NULL DEFAULT 'RECEIPT',
  classification_confidence NUMERIC(4, 3),
  merchant_name VARCHAR(255),
  merchant_address TEXT,
  purchase_date DATE,
  purchase_time TIME,
  payment_method VARCHAR(50),
  card_company VARCHAR(100),
  total_amount NUMERIC(12, 2) CHECK (total_amount >= 0),
  currency_code VARCHAR(10) DEFAULT 'KRW',
  raw_text TEXT,
  parsed_json JSONB,
  raw_json JSONB,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipt_items (
  id SERIAL PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  item_name VARCHAR(255) NOT NULL,
  quantity NUMERIC(10, 2) CHECK (quantity >= 0),
  unit_price NUMERIC(12, 2) CHECK (unit_price >= 0),
  total_price NUMERIC(12, 2) CHECK (total_price >= 0),
  category VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_merchant_name_trgm ON receipts USING GIN (merchant_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_receipts_merchant_address_trgm ON receipts USING GIN (merchant_address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_receipts_payment_method_trgm ON receipts USING GIN (payment_method gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_receipts_card_company_trgm ON receipts USING GIN (card_company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_receipts_raw_text_trgm ON receipts USING GIN (raw_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_receipts_purchase_date ON receipts(purchase_date);
CREATE INDEX IF NOT EXISTS idx_receipts_embedding_hnsw ON receipts USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_item_name_trgm ON receipt_items USING GIN (item_name gin_trgm_ops);
