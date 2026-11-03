package com.mora.security;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import static org.junit.jupiter.api.Assertions.*;

class OcrAccessTokensTest {
    private final String secret = "test-only-secret-that-is-at-least-32-characters";

    @Test
    void serviceCredentialIsShortLivedAndBoundToOperationAndImage() throws Exception {
        var key = Keys.hmacShaKeyFor(MessageDigest.getInstance("SHA-256")
                .digest(("mora-ocr-service:" + secret).getBytes(StandardCharsets.UTF_8)));
        var claims = Jwts.parser().verifyWith(key).requireIssuer("mora-spring")
                .requireAudience("mora-ocr").build()
                .parseSignedClaims(new OcrAccessTokens(secret).issue("read", "mine.jpg")).getPayload();
        assertEquals("read", claims.get("operation"));
        assertEquals("mine.jpg", claims.get("image_name"));
        assertEquals(120_000, claims.getExpiration().getTime() - claims.getIssuedAt().getTime());
    }

    @Test
    void userJwtCannotAuthenticateAsOcrGateway() {
        String serviceToken = new OcrAccessTokens(secret).issue("scan", null);
        assertFalse(new JwtUtil(secret, 120_000).isValid(serviceToken));
        assertThrows(IllegalArgumentException.class, () -> new OcrAccessTokens("short"));
    }
}
