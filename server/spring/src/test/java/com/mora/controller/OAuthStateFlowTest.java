package com.mora.controller;

import com.mora.dto.AuthResponse;
import com.mora.dto.OAuthProfile;
import com.mora.repository.OAuthStateRepository;
import com.mora.security.JwtUtil;
import com.mora.security.OAuthStateService;
import com.mora.security.OAuthStateService.Provider;
import com.mora.security.PasswordChangeRateLimiter;
import com.mora.service.*;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class OAuthStateFlowTest {

    private final OAuthStateRepository repository = mock(OAuthStateRepository.class);
    private final AuthService auth = mock(AuthService.class);
    private final GoogleOAuthService google = spy(new GoogleOAuthService(mock(RestTemplate.class),
            "google-id", "google-secret", "https://api.example/auth/google/callback"));
    private final KakaoOAuthService kakao = spy(new KakaoOAuthService(mock(RestTemplate.class),
            "kakao-id", "", "https://api.example/auth/kakao/callback"));
    private final NaverOAuthService naver = spy(new NaverOAuthService(mock(RestTemplate.class),
            "naver-id", "naver-secret", "https://api.example/auth/naver/callback"));
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new AuthController(auth, google, kakao, naver,
                mock(JwtUtil.class), mock(PasswordChangeRateLimiter.class),
                new OAuthStateService(repository), "mora://auth")).build();
    }

    @ParameterizedTest
    @EnumSource(Provider.class)
    void validStateMaintainsAppReturnFlowAndReplayNeverExchangesAgain(Provider provider) throws Exception {
        Attempt attempt = login(provider);
        allowOnce(provider, attempt);
        OAuthProfile profile = new OAuthProfile(provider.value(), "test@example.com", "Test", "");
        switch (provider) {
            case GOOGLE -> doReturn(profile).when(google).profile("code");
            case KAKAO -> doReturn(profile).when(kakao).profile("code");
            case NAVER -> doReturn(profile).when(naver).profile("code", attempt.state());
        }
        UUID userId = UUID.randomUUID();
        when(auth.loginWithOAuth(profile)).thenReturn(new AuthResponse("app-token", userId, "test@example.com", "Test"));
        mvc.perform(callback(provider, attempt))
                .andExpect(status().isFound())
                .andExpect(redirectedUrl("mora://auth/dashboard?token=app-token&userId=" + userId
                        + "&email=test@example.com&name=Test&provider=" + provider.value()))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, org.hamcrest.Matchers.containsString("Max-Age=0")));
        assertFailure(provider, callback(provider, attempt));
        switch (provider) {
            case GOOGLE -> verify(google, times(1)).profile("code");
            case KAKAO -> verify(kakao, times(1)).profile("code");
            case NAVER -> verify(naver, times(1)).profile("code", attempt.state());
        }
        verify(auth, times(1)).loginWithOAuth(profile);
    }

    static Stream<Object[]> invalidCases() {
        return Stream.of(Provider.values()).flatMap(provider -> Stream.of("missing-state", "missing-cookie",
                "wrong-state", "wrong-browser", "wrong-provider", "expired", "duplicate-cookie", "no-code", "denied")
                .map(reason -> new Object[]{provider, reason}));
    }

    @ParameterizedTest(name = "{0}: {1}")
    @MethodSource("invalidCases")
    void invalidCallbacksNeverReachTokenExchange(Provider provider, String reason) throws Exception {
        Attempt attempt = login(provider);
        if (!reason.equals("expired")) {
            allowOnce(provider, attempt);
        }
        Provider callbackProvider = reason.equals("wrong-provider")
                ? Provider.values()[(provider.ordinal() + 1) % 3] : provider;
        var request = get("/auth/" + callbackProvider.value() + "/callback");
        if (!reason.equals("no-code")) request.param("code", "code");
        if (!reason.equals("missing-state")) {
            request.param("state", reason.equals("wrong-state") ? "x".repeat(43) : attempt.state());
        }
        if (!reason.equals("missing-cookie")) {
            request.cookie(new Cookie(callbackProvider.cookieName(),
                    reason.equals("wrong-browser") ? "y".repeat(43) : attempt.browser()));
        }
        if (reason.equals("duplicate-cookie")) {
            request.cookie(new Cookie(callbackProvider.cookieName(), "z".repeat(43)));
        }
        if (reason.equals("denied")) request.param("error", "access_denied");
        assertFailure(callbackProvider, request);
        verify(google, never()).profile(any());
        verify(kakao, never()).profile(any());
        verify(naver, never()).profile(any(), any());
        verifyNoInteractions(auth);
    }

    @ParameterizedTest
    @EnumSource(Provider.class)
    void databaseFailureDeniesCallbackWithoutExchange(Provider provider) throws Exception {
        Attempt attempt = login(provider);
        when(repository.consume(anyString(), anyString(), anyString())).thenThrow(new RuntimeException("DB unavailable"));
        assertFailure(provider, callback(provider, attempt));
        verify(google, never()).profile(any());
        verify(kakao, never()).profile(any());
        verify(naver, never()).profile(any(), any());
        verifyNoInteractions(auth);
    }

    @ParameterizedTest
    @EnumSource(Provider.class)
    void failedTokenExchangeCannotReuseConsumedState(Provider provider) throws Exception {
        Attempt attempt = login(provider);
        allowOnce(provider, attempt);
        RuntimeException upstreamFailure = new RuntimeException("Provider unavailable");
        switch (provider) {
            case GOOGLE -> doThrow(upstreamFailure).when(google).profile("code");
            case KAKAO -> doThrow(upstreamFailure).when(kakao).profile("code");
            case NAVER -> doThrow(upstreamFailure).when(naver).profile("code", attempt.state());
        }
        assertFailure(provider, callback(provider, attempt));
        assertFailure(provider, callback(provider, attempt));
        switch (provider) {
            case GOOGLE -> verify(google, times(1)).profile("code");
            case KAKAO -> verify(kakao, times(1)).profile("code");
            case NAVER -> verify(naver, times(1)).profile("code", attempt.state());
        }
        verifyNoInteractions(auth);
    }

    @ParameterizedTest
    @EnumSource(Provider.class)
    void staleCallbackDoesNotClearOrConsumeNewerLoginCookie(Provider provider) throws Exception {
        Attempt first = login(provider);
        Attempt latest = login(provider);
        allowOnce(provider, latest);
        mvc.perform(get("/auth/" + provider.value() + "/callback")
                        .param("code", "code").param("state", first.state())
                        .cookie(new Cookie(provider.cookieName(), latest.browser())))
                .andExpect(status().isFound())
                .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
        OAuthProfile profile = new OAuthProfile(provider.value(), "test@example.com", "Test", "");
        switch (provider) {
            case GOOGLE -> doReturn(profile).when(google).profile("code");
            case KAKAO -> doReturn(profile).when(kakao).profile("code");
            case NAVER -> doReturn(profile).when(naver).profile("code", latest.state());
        }
        when(auth.loginWithOAuth(profile)).thenReturn(new AuthResponse("app-token", UUID.randomUUID(), "test@example.com", "Test"));
        mvc.perform(callback(provider, latest)).andExpect(status().isFound())
                .andExpect(header().string(HttpHeaders.LOCATION, org.hamcrest.Matchers.containsString("/dashboard?token=")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, org.hamcrest.Matchers.containsString("Max-Age=0")));
    }

    private Attempt login(Provider provider) throws Exception {
        var response = mvc.perform(get("/auth/" + provider.value() + "/login"))
                .andExpect(status().isFound())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andReturn().getResponse();
        String state = UriComponentsBuilder.fromUriString(response.getHeader(HttpHeaders.LOCATION))
                .build().getQueryParams().getFirst("state");
        Cookie cookie = response.getCookie(provider.cookieName());
        assertNotNull(state);
        assertNotNull(cookie);
        assertTrue(cookie.getSecure());
        assertTrue(cookie.isHttpOnly());
        assertEquals("Lax", cookie.getAttribute("SameSite"));
        assertEquals("/", cookie.getPath());
        assertNull(cookie.getDomain());
        verify(repository).create(sha256(state), sha256(cookie.getValue()), provider.value());
        return new Attempt(state, cookie.getValue());
    }

    private void allowOnce(Provider provider, Attempt attempt) throws Exception {
        when(repository.consume(sha256(attempt.state()), sha256(attempt.browser()), provider.value()))
                .thenReturn(true, false);
    }

    private MockHttpServletRequestBuilder callback(Provider provider, Attempt attempt) {
        return get("/auth/" + provider.value() + "/callback").param("code", "code").param("state", attempt.state())
                .cookie(new Cookie(provider.cookieName(), attempt.browser()));
    }

    private void assertFailure(Provider provider, MockHttpServletRequestBuilder request) throws Exception {
        mvc.perform(request).andExpect(status().isFound())
                .andExpect(redirectedUrl("mora://auth/login?oauth_error=" + provider.value()));
    }

    private String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.US_ASCII)));
    }

    private record Attempt(String state, String browser) {}
}
