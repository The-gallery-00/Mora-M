package com.mora.service;

import com.mora.dto.OAuthProfile;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Map;

@Service
public class KakaoOAuthService {

    private static final String AUTH_URL = "https://kauth.kakao.com/oauth/authorize";
    private static final String TOKEN_URL = "https://kauth.kakao.com/oauth/token";
    private static final String USERINFO_URL = "https://kapi.kakao.com/v2/user/me";

    private final RestTemplate restTemplate;
    private final String clientId;
    private final String clientSecret;
    private final String redirectUri;

    public KakaoOAuthService(
            @Qualifier("oauthRestTemplate") RestTemplate restTemplate,
            @Value("${app.oauth.kakao.client-id:}") String clientId,
            @Value("${app.oauth.kakao.client-secret:}") String clientSecret,
            @Value("${app.oauth.kakao.redirect-uri:}") String redirectUri) {
        this.restTemplate = restTemplate;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
    }

    public String authorizationUrl() {
        validateConfigured();
        return UriComponentsBuilder.fromUriString(AUTH_URL)
                .queryParam("client_id", clientId)
                .queryParam("redirect_uri", redirectUri)
                .queryParam("response_type", "code")
                .queryParam("scope", "account_email,profile_nickname,profile_image")
                .build()
                .encode()
                .toUriString();
    }

    public OAuthProfile profile(String code) {
        validateConfigured();
        if (code == null || code.isBlank()) {
            throw new RuntimeException("Kakao authorization code is required");
        }

        String accessToken = exchangeAccessToken(code);
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);

        ResponseEntity<Map> response = restTemplate.exchange(
                USERINFO_URL,
                org.springframework.http.HttpMethod.GET,
                new HttpEntity<>(headers),
                Map.class);

        Map<?, ?> body = response.getBody();
        Map<?, ?> kakaoAccount = map(body, "kakao_account");
        Map<?, ?> profile = map(kakaoAccount, "profile");

        String email = string(kakaoAccount, "email");
        if (email.isBlank()) {
            throw new RuntimeException("Kakao profile email is required");
        }

        return new OAuthProfile(
                "kakao",
                email,
                string(profile, "nickname"),
                firstNonBlank(string(profile, "profile_image_url"), string(profile, "thumbnail_image_url")));
    }

    private String exchangeAccessToken(String code) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("code", code);
        body.add("client_id", clientId);
        if (clientSecret != null && !clientSecret.isBlank()) {
            body.add("client_secret", clientSecret);
        }
        body.add("redirect_uri", redirectUri);
        body.add("grant_type", "authorization_code");

        ResponseEntity<Map> response = restTemplate.postForEntity(
                TOKEN_URL,
                new HttpEntity<>(body, headers),
                Map.class);

        String accessToken = string(response.getBody(), "access_token");
        if (accessToken.isBlank()) {
            throw new RuntimeException("Kakao access token is required");
        }
        return accessToken;
    }

    private void validateConfigured() {
        if (clientId == null || clientId.isBlank()
                || redirectUri == null || redirectUri.isBlank()) {
            throw new RuntimeException("Kakao OAuth is not configured");
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

    private static String firstNonBlank(String first, String second) {
        return first == null || first.isBlank() ? second : first;
    }
}
