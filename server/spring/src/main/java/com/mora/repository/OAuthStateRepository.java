package com.mora.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class OAuthStateRepository {

    private final JdbcTemplate jdbc;

    public OAuthStateRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void create(String stateHash, String browserHash, String provider) {
        jdbc.update("DELETE FROM oauth_login_states WHERE expires_at <= CURRENT_TIMESTAMP");
        jdbc.update("""
                INSERT INTO oauth_login_states (state_hash, browser_hash, provider, expires_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP + INTERVAL '10 minutes')
                """, stateHash, browserHash, provider);
    }

    // One conditional DELETE makes concurrent callbacks across replicas mutually exclusive.
    // Its independent transaction commits before any provider token request is attempted.
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean consume(String stateHash, String browserHash, String provider) {
        return jdbc.update("""
                DELETE FROM oauth_login_states
                WHERE state_hash = ? AND browser_hash = ? AND provider = ?
                  AND expires_at > CURRENT_TIMESTAMP
                """, stateHash, browserHash, provider) == 1;
    }
}
