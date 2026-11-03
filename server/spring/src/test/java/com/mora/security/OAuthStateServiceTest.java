package com.mora.security;

import com.mora.repository.OAuthStateRepository;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.mock.web.MockHttpServletRequest;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OAuthStateServiceTest {

    private final OAuthStateRepository repository = mock(OAuthStateRepository.class);
    private final OAuthStateService service = new OAuthStateService(repository);

    @ParameterizedTest
    @EnumSource(OAuthStateService.Provider.class)
    void issuesIndependentSecretsAndPersistsOnlyHashes(OAuthStateService.Provider provider) throws Exception {
        var issued = service.issue(provider);
        String browser = issued.cookie().getValue();
        assertTrue(issued.state().matches("[A-Za-z0-9_-]{43}"));
        assertTrue(browser.matches("[A-Za-z0-9_-]{43}"));
        assertNotEquals(issued.state(), browser);
        assertEquals(provider.cookieName(), issued.cookie().getName());
        assertTrue(issued.cookie().isSecure());
        assertTrue(issued.cookie().isHttpOnly());
        assertEquals("Lax", issued.cookie().getSameSite());
        assertEquals("/", issued.cookie().getPath());
        assertNull(issued.cookie().getDomain());
        assertEquals(600, issued.cookie().getMaxAge().getSeconds());
        verify(repository).create(sha256(issued.state()), sha256(browser), provider.value());
        var second = service.issue(provider);
        assertNotEquals(issued.state(), second.state());
        assertNotEquals(browser, second.cookie().getValue());
        assertEquals(0, service.clearCookie(provider).getMaxAge().getSeconds());
    }

    @Test
    void malformedMissingAndDuplicateCookiesFailWithoutDatabaseAccess() {
        var provider = OAuthStateService.Provider.GOOGLE;
        var request = new MockHttpServletRequest();
        String state = "a".repeat(43);
        assertThrows(IllegalArgumentException.class, () -> service.verifyAndConsume(provider, state, request));
        request.setCookies(new Cookie(provider.cookieName(), "b".repeat(43)));
        for (String invalid : new String[]{null, "", " ", "short", "a".repeat(44), "!".repeat(43)}) {
            assertThrows(IllegalArgumentException.class,
                    () -> service.verifyAndConsume(provider, invalid, request));
        }
        request.setCookies(new Cookie(provider.cookieName(), "b".repeat(43)),
                new Cookie(provider.cookieName(), "c".repeat(43)));
        assertThrows(IllegalArgumentException.class, () -> service.verifyAndConsume(provider, state, request));
        verifyNoInteractions(repository);
    }

    @Test
    void consumeUsesBothHashesAndProviderAndFailsClosed() throws Exception {
        var provider = OAuthStateService.Provider.NAVER;
        var issued = service.issue(provider);
        var request = new MockHttpServletRequest();
        request.setCookies(new Cookie(provider.cookieName(), issued.cookie().getValue()));
        when(repository.consume(sha256(issued.state()), sha256(issued.cookie().getValue()), "naver"))
                .thenReturn(true, false);
        assertDoesNotThrow(() -> service.verifyAndConsume(provider, issued.state(), request));
        assertThrows(IllegalArgumentException.class,
                () -> service.verifyAndConsume(provider, issued.state(), request));
        verify(repository, times(2)).consume(sha256(issued.state()), sha256(issued.cookie().getValue()), "naver");
    }

    static String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.US_ASCII)));
    }
}
