package com.mora.controller;

import com.mora.security.JwtUtil;
import com.mora.service.PosterService;
import com.mora.service.ReceiptService;
import com.mora.service.SearchHistoryService;
import com.mora.service.TicketService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;
import java.util.stream.Stream;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class DocumentImageRejectionControllerTest {
    enum Type { POSTER, TICKET, RECEIPT }
    enum Mutation { SAVE, UPDATE, DELETE }

    private static final String PRIVATE_REASON = "private-owner-id/storage-path";
    private static final String BODY = "{\"parsedJson\":\"{\\\"imageUrl\\\":\\\"/uploads/not-owned.jpg\\\"}\"}";

    private final PosterService posters = mock(PosterService.class);
    private final TicketService tickets = mock(TicketService.class);
    private final ReceiptService receipts = mock(ReceiptService.class);
    private final SearchHistoryService searches = mock(SearchHistoryService.class);
    private final JwtUtil jwt = new JwtUtil("test-only-secret-that-is-at-least-32-characters", 120_000);
    private final UUID owner = UUID.randomUUID();
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(
                new PosterController(posters, jwt, searches),
                new TicketController(tickets, jwt, searches),
                new ReceiptController(receipts, jwt, searches)).build();
    }

    @ParameterizedTest(name = "{0} {1} preserves {2} without leaking the exception")
    @MethodSource("rejectedMutations")
    void invalidImageReferenceKeepsClientStatus(Type type, Mutation mutation, HttpStatus expected) throws Exception {
        ResponseStatusException rejection = new ResponseStatusException(expected, PRIVATE_REASON);
        String base = switch (type) {
            case POSTER -> {
                when(posters.save(eq(owner), any())).thenThrow(rejection);
                when(posters.update(eq(owner), eq(1), any())).thenThrow(rejection);
                doThrow(rejection).when(posters).delete(owner, 1);
                yield "/api/posters";
            }
            case TICKET -> {
                when(tickets.save(eq(owner), any())).thenThrow(rejection);
                when(tickets.update(eq(owner), eq(1), any())).thenThrow(rejection);
                doThrow(rejection).when(tickets).delete(owner, 1);
                yield "/api/tickets";
            }
            case RECEIPT -> {
                when(receipts.save(eq(owner), any())).thenThrow(rejection);
                when(receipts.update(eq(owner), eq(1), any())).thenThrow(rejection);
                doThrow(rejection).when(receipts).delete(owner, 1);
                yield "/api/receipts";
            }
        };
        MockHttpServletRequestBuilder request = switch (mutation) {
            case SAVE -> post(base + "/save").contentType(MediaType.APPLICATION_JSON).content(BODY);
            case UPDATE -> put(base + "/1").contentType(MediaType.APPLICATION_JSON).content(BODY);
            case DELETE -> delete(base + "/1");
        };

        mvc.perform(request.header("Authorization", "Bearer " + jwt.generateToken(owner, "test@example.invalid")))
                .andExpect(status().is(expected.value()))
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error").value("Invalid image reference"))
                .andExpect(jsonPath("$.data").doesNotExist())
                .andExpect(content().string(not(containsString(PRIVATE_REASON))));
        verifyNoInteractions(searches);
    }

    private static Stream<Arguments> rejectedMutations() {
        return Stream.of(Type.values()).flatMap(type ->
                Stream.of(Mutation.values()).flatMap(mutation ->
                        Stream.of(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
                                .map(status -> Arguments.of(type, mutation, status))));
    }
}
