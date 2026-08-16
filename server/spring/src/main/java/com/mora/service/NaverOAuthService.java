package com.mora.service;

import com.mora.dto.OAuthProfile;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Map;
import java.util.UUID;

@Service
public class NaverOAuthService {

    private static final String AUTH_URL = "https://nid.naver.com/oauth2.0/authorize";
    private static final String TOKEN_URL = "https://nid.naver.com/oauth2.0/token";
    private static final String USERINFO_URL = "https://openapi.naver.com/v1/nid/me";

    private final RestTemplate restTemplate;
    private final String clientId;
    private final String clientSecret;
    private final String redirectUri;

    public NaverOAuthService(
            @Qualifier("oauthRestTemplate") RestTemplate restTemplate,
            @Value("${app.oauth.naver.client-id:}") String clientId,
            @Value("${app.oauth.naver.client-secret:}") String clientSecret,
            @Value("${app.oauth.naver.redirect-uri:}") String redirectUri) {
        this.restTemplate = restTemplate;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
    }

    public String authorizationUrl() {
        validateConfigured();
        return UriComponentsBuilder.fromUriString(AUTH_URL)
                .queryParam("response_type", "code")
                .queryParam("client_id", clientId)
                .queryParam("redirect_uri", redirectUri)
                .queryParam("state", UUID.randomUUID().toString())
                .build()
                .encode()
                .toUriString();
    }

    public OAuthProfile profile(String code, String state) {
        validateConfigured();
        if (code == null || code.isBlank()) {
            throw new RuntimeException("Naver authorization code is required");
        }
        if (state == null || state.isBlank()) {
            throw new RuntimeException("Naver authorization state is required");
        }

        String accessToken = exchangeAccessToken(code, state);
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);

        ResponseEntity<Map> response = restTemplate.exchange(
                USERINFO_URL,
                org.springframework.http.HttpMethod.GET,
                new HttpEntity<>(headers),
                Map.class);

        Map<?, ?> profile = map(response.getBody(), "response");
        String email = string(profile, "email");
        if (email.isBlank()) {
            throw new RuntimeException("Naver profile email is required");
        }

        return new OAuthProfile(
                "naver",
                email,
                string(profile, "nickname"),
                string(profile, "profile_image"));
    }

    private String exchangeAccessToken(String code, String state) {
        String url = UriComponentsBuilder.fromUriString(TOKEN_URL)
                .queryParam("grant_type", "authorization_code")
                .queryParam("client_id", clientId)
                .queryParam("client_secret", clientSecret)
                .queryParam("code", code)
                .queryParam("state", state)
                .build()
                .encode()
                .toUriString();

        ResponseEntity<Map> response = restTemplate.getForEntity(url, Map.class);
        String accessToken = string(response.getBody(), "access_token");
        if (accessToken.isBlank()) {
            throw new RuntimeException("Naver access token is required");
        }
        return accessToken;
    }

    private void validateConfigured() {
        if (clientId == null || clientId.isBlank()
                || clientSecret == null || clientSecret.isBlank()
                || redirectUri == null || redirectUri.isBlank()) {
            throw new RuntimeException("Naver OAuth is not configured");
        }
    }

    private static Map<?, ?> map(Map<?, ?> body, String key) {
        if (body == null) return Map.of();
        Object value = body.get(key);
        return value instanceof Map<?, ?> nested ? nested : Map.of();
    }

    private static String string(Map<?, ?> body, String key) {
        if (body == null) return "";
        Object value = body.get(key);
        return value == null ? "" : String.valueOf(value).trim();
    }
}
