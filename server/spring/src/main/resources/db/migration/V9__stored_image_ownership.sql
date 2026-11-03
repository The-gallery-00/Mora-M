CREATE TABLE stored_images (
    image_name VARCHAR(200) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stored_images_safe_name CHECK (
        image_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' AND position('..' in image_name) = 0
    )
);
CREATE INDEX idx_stored_images_user_id ON stored_images(user_id, created_at);

-- No user FK: a scan can finish after account deletion. Persist compensation in
-- its own transaction before contacting storage so failures survive that race.
CREATE TABLE stored_image_deletions (
    image_name VARCHAR(200) PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stored_image_deletions_safe_name CHECK (
        image_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' AND position('..' in image_name) = 0
    )
);

-- These functions are also used by prepared reference checks after document flush.
-- Invalid legacy data aborts the migration instead of silently granting ownership.
CREATE FUNCTION stored_image_name(reference TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    path TEXT;
    name TEXT;
BEGIN
    IF reference IS NULL OR reference = '' THEN RETURN NULL; END IF;
    path := reference;
    IF reference ~* '^https?://' THEN
        IF reference !~* '^https?://[^/?#@[:space:]]+/uploads/' THEN
            RAISE EXCEPTION 'Unsupported absolute stored image reference';
        END IF;
        path := regexp_replace(reference, '^https?://[^/]+', '', 'i');
    END IF;
    IF path !~ '^/uploads/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' THEN
        RAISE EXCEPTION 'Unsafe stored image reference';
    END IF;
    name := substring(path FROM 10);
    IF position('..' in name) > 0 THEN RAISE EXCEPTION 'Unsafe stored image name'; END IF;
    RETURN name;
END;
$$;

CREATE FUNCTION stored_image_json_names_walk(payload JSONB) RETURNS TEXT[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    names TEXT[] := ARRAY[]::TEXT[];
    item RECORD;
    child JSONB;
    name TEXT;
BEGIN
    IF jsonb_typeof(payload) = 'object' THEN
        FOR item IN SELECT key, value FROM jsonb_each(payload) LOOP
            IF item.key IN ('imageUrl', 'image_url') THEN
                IF jsonb_typeof(item.value) NOT IN ('string', 'null') THEN
                    RAISE EXCEPTION 'Invalid JSON stored image reference';
                END IF;
                name := stored_image_name(item.value #>> '{}');
                IF name IS NOT NULL THEN names := array_append(names, name); END IF;
            ELSE
                names := names || stored_image_json_names_walk(item.value);
            END IF;
        END LOOP;
    ELSIF jsonb_typeof(payload) = 'array' THEN
        FOR child IN SELECT value FROM jsonb_array_elements(payload) LOOP
            names := names || stored_image_json_names_walk(child);
        END LOOP;
    END IF;
    RETURN names;
END;
$$;

-- Document JSON is an object, an OCR-block array, null, or one encoded object/array.
CREATE FUNCTION stored_image_json_names(payload JSONB) RETURNS TEXT[]
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF payload IS NULL OR payload = 'null'::jsonb THEN RETURN ARRAY[]::TEXT[]; END IF;
    IF jsonb_typeof(payload) = 'string' THEN payload := (payload #>> '{}')::jsonb; END IF;
    IF jsonb_typeof(payload) NOT IN ('object', 'array', 'null') THEN
        RAISE EXCEPTION 'Unsupported document JSON shape';
    END IF;
    RETURN stored_image_json_names_walk(payload);
END;
$$;

CREATE TEMP TABLE stored_image_backfill ON COMMIT DROP AS
SELECT stored_image_name(image_url) AS image_name, user_id, created_at
FROM business_cards
UNION ALL
SELECT name, user_id, created_at FROM posters
CROSS JOIN LATERAL unnest(stored_image_json_names(parsed_json) || stored_image_json_names(raw_json)) AS name
UNION ALL
SELECT name, user_id, created_at FROM tickets
CROSS JOIN LATERAL unnest(stored_image_json_names(parsed_json) || stored_image_json_names(raw_json)) AS name
UNION ALL
SELECT name, user_id, created_at FROM receipts
CROSS JOIN LATERAL unnest(stored_image_json_names(parsed_json) || stored_image_json_names(raw_json)) AS name;

DO $$
BEGIN
    IF EXISTS (
        SELECT image_name FROM stored_image_backfill WHERE image_name IS NOT NULL
        GROUP BY image_name HAVING count(DISTINCT user_id) > 1 OR bool_or(user_id IS NULL)
    ) THEN
        RAISE EXCEPTION 'Conflicting stored image ownership; resolve legacy references before retrying V9';
    END IF;
END;
$$;

INSERT INTO stored_images(image_name, user_id, created_at)
SELECT image_name, user_id, coalesce(min(created_at), now())
FROM stored_image_backfill WHERE image_name IS NOT NULL
GROUP BY image_name, user_id;
