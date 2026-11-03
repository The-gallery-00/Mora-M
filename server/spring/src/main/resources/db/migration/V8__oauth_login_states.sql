CREATE TABLE oauth_login_states (
    state_hash VARCHAR(64) PRIMARY KEY,
    browser_hash VARCHAR(64) NOT NULL,
    provider VARCHAR(10) NOT NULL CHECK (provider IN ('google', 'kakao', 'naver')),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_oauth_login_states_expiry ON oauth_login_states (expires_at);
