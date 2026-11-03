package com.mora.security;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Date;

@Component
public class OcrAccessTokens {
    private final SecretKey key;

    public OcrAccessTokens(@Value("${app.ocr-shared-secret}") String secret) {
        if (secret == null || secret.length() < 32) {
            throw new IllegalArgumentException("OCR shared secret must contain at least 32 characters");
        }
        try {
            // Domain-separate this credential from every other use of the service secret.
            byte[] derived = MessageDigest.getInstance("SHA-256")
                    .digest(("mora-ocr-service:" + secret).getBytes(StandardCharsets.UTF_8));
            key = Keys.hmacShaKeyFor(derived);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public String issue(String operation, String imageName) {
        Instant now = Instant.now();
        return Jwts.builder()
                .issuer("mora-spring")
                .audience().add("mora-ocr").and()
                .claim("operation", operation)
                .claim("image_name", imageName == null ? "" : imageName)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(120)))
                .signWith(key)
                .compact();
    }
}
