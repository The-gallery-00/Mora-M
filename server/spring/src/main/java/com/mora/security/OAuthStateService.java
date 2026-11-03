package com.mora.security;

import com.mora.repository.OAuthStateRepository;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;

@Service
public class OAuthStateService {

    public enum Provider {
        GOOGLE("google"), KAKAO("kakao"), NAVER("naver");

        private final String value;

        Provider(String value) {
            this.value = value;
        }

        public String value() {
            return value;
        }

        public String cookieName() {
            return "__Host-mora-oauth-" + value;
        }
    }

    public record IssuedState(String state, ResponseCookie cookie) {
        @Override
        public String toString() {
            return "IssuedState[redacted]";
        }
    }

    private static final Duration TTL = Duration.ofMinutes(10);
    private final SecureRandom random = new SecureRandom();
    private final OAuthStateRepository repository;

    public OAuthStateService(OAuthStateRepository repository) {
        this.repository = repository;
    }

    public IssuedState issue(Provider provider) {
        String state = randomSecret();
        String browserSecret = randomSecret();
        repository.create(hash(state), hash(browserSecret), provider.value());
        return new IssuedState(state, cookie(provider, browserSecret, TTL));
    }

    public void verifyAndConsume(Provider provider, String state, HttpServletRequest request) {
        String browserSecret = browserSecret(provider, request);
        if (!validSecret(state) || !validSecret(browserSecret)
                || !repository.consume(hash(state), hash(browserSecret), provider.value())) {
            throw new IllegalArgumentException("Invalid OAuth state");
        }
    }

    public ResponseCookie clearCookie(Provider provider) {
        return cookie(provider, "", Duration.ZERO);
    }

    private ResponseCookie cookie(Provider provider, String value, Duration maxAge) {
        // __Host- requires Secure, Path=/ and no Domain, preventing subdomain cookie injection.
        return ResponseCookie.from(provider.cookieName(), value)
                .secure(true).httpOnly(true).sameSite("Lax").path("/").maxAge(maxAge).build();
    }

    private String browserSecret(Provider provider, HttpServletRequest request) {
        String secret = null;
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie cookie : cookies) {
                if (provider.cookieName().equals(cookie.getName())) {
                    if (secret != null) {
                        return null;
                    }
                    secret = cookie.getValue();
                }
            }
        }
        return secret;
    }

    private boolean validSecret(String value) {
        return value != null && value.matches("[A-Za-z0-9_-]{43}");
    }

    private String randomSecret() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
