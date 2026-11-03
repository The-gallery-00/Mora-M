package com.mora.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mora.dto.*;
import com.mora.entity.*;
import com.mora.repository.*;
import com.mora.security.JwtUtil;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DocumentImageLifecycleTest {
    enum Type { CARD, POSTER, TICKET, RECEIPT }

    private final UUID owner = UUID.randomUUID();
    private final UUID cardId = UUID.randomUUID();
    private final BusinessCardRepository cards = mock(BusinessCardRepository.class);
    private final CardGroupRepository groups = mock(CardGroupRepository.class);
    private final PosterRepository posters = mock(PosterRepository.class);
    private final TicketRepository tickets = mock(TicketRepository.class);
    private final ReceiptRepository receipts = mock(ReceiptRepository.class);
    private final EmbeddingService embedding = mock(EmbeddingService.class);
    private final StoredImageService images = mock(StoredImageService.class);

    @ParameterizedTest
    @EnumSource(Type.class)
    void forgedImageIsRejectedOnEverySaveAndUpdate(Type type) {
        UUID victim = UUID.randomUUID();
        StoredImageRepository registry = mock(StoredImageRepository.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        OcrService ocr = mock(OcrService.class);
        when(jdbc.queryForList(anyString(), eq(UUID.class), any(Object[].class))).thenReturn(List.of(owner));
        when(registry.findById("victim.jpg")).thenReturn(Optional.of(new StoredImage("victim.jpg", victim)));
        StoredImageService realImages = new StoredImageService(registry, ocr, jdbc, new ObjectMapper(),
                mock(StoredImageDeletionService.class), mock(StoredImageRegistrationService.class));
        seed(type);
        assertThrows(ResponseStatusException.class, () -> save(type, realImages, "/uploads/victim.jpg"));
        assertThrows(ResponseStatusException.class, () -> update(type, realImages, "/uploads/victim.jpg"));
        verify(cards, never()).save(any());
        verify(posters, never()).save(any());
        verify(tickets, never()).save(any());
        verify(receipts, never()).save(any());
        verifyNoInteractions(ocr);
    }

    @ParameterizedTest
    @EnumSource(Type.class)
    void documentDeletionFlushesBeforeCheckingForOrphans(Type type) {
        Object document = seed(type);
        when(images.referencesInJson(any(), any())).thenReturn(Set.of("/uploads/old.jpg"));
        delete(type);
        var order = inOrder(images, cards, posters, tickets, receipts);
        order.verify(images).lockOwner(owner);
        switch (type) {
            case CARD -> { order.verify(cards).delete((BusinessCard) document); order.verify(cards).flush(); }
            case POSTER -> { order.verify(posters).delete((Poster) document); order.verify(posters).flush(); }
            case TICKET -> { order.verify(tickets).delete((Ticket) document); order.verify(tickets).flush(); }
            case RECEIPT -> { order.verify(receipts).delete((Receipt) document); order.verify(receipts).flush(); }
        }
        order.verify(images).deleteIfUnreferenced(owner, "/uploads/old.jpg");
    }

    @ParameterizedTest
    @EnumSource(Type.class)
    void imageReplacementFlushesNewReferenceBeforeOldImageCleanup(Type type) {
        seed(type);
        when(images.referencesInJson(any(), any())).thenReturn(Set.of("/uploads/old.jpg"));
        when(images.normalizeOwnedReference(eq(owner), anyString())).thenAnswer(call -> call.getArgument(1));
        when(images.normalizeOwnedJson(eq(owner), anyString())).thenAnswer(call -> call.getArgument(1));
        when(cards.save(any())).thenAnswer(call -> call.getArgument(0));
        when(posters.save(any())).thenAnswer(call -> call.getArgument(0));
        when(tickets.save(any())).thenAnswer(call -> call.getArgument(0));
        when(receipts.save(any())).thenAnswer(call -> call.getArgument(0));
        update(type, images, "/uploads/new.jpg");
        var order = inOrder(images, cards, posters, tickets, receipts);
        switch (type) {
            case CARD -> order.verify(cards).flush();
            case POSTER -> order.verify(posters).flush();
            case TICKET -> order.verify(tickets).flush();
            case RECEIPT -> order.verify(receipts).flush();
        }
        order.verify(images).deleteIfUnreferenced(owner, "/uploads/old.jpg");
    }

    @Test
    void accountDeletionCleansRegistryBeforeDeletingUserAndPropagatesFailureForRetry() {
        UserRepository users = mock(UserRepository.class);
        User user = new User();
        user.setId(owner);
        when(users.findById(owner)).thenReturn(Optional.of(user));
        AuthService auth = new AuthService(users, mock(PasswordEncoder.class), mock(JwtUtil.class), images);
        doThrow(new RuntimeException("upstream unavailable")).doNothing().when(images).deleteAll(owner);
        assertThrows(RuntimeException.class, () -> auth.deleteAccount(owner));
        verify(users, never()).delete(any());
        auth.deleteAccount(owner);
        var order = inOrder(images, users);
        order.verify(images, times(2)).deleteAll(owner);
        order.verify(users).delete(user);
    }

    @Test
    void deleteAllDocumentsIncludesAllFourTypesAndKeepsDocumentsOnImageFailure() {
        SearchHistoryService searches = mock(SearchHistoryService.class);
        NotificationService notifications = mock(NotificationService.class);
        UserDataService service = new UserDataService(cards, posters, tickets, receipts, images, searches, notifications);
        doThrow(new RuntimeException("upstream unavailable")).doNothing().when(images).deleteAll(owner);
        assertThrows(RuntimeException.class, () -> service.deleteAllDocuments(owner));
        verifyNoInteractions(cards, posters, tickets, receipts, searches, notifications);
        service.deleteAllDocuments(owner);
        var order = inOrder(images, cards, posters, tickets, receipts);
        order.verify(images, times(2)).deleteAll(owner);
        order.verify(cards).deleteByUserId(owner);
        order.verify(tickets).deleteByUserId(owner);
        order.verify(posters).deleteByUserId(owner);
        order.verify(receipts).deleteByUserId(owner);
    }

    private Object seed(Type type) {
        return switch (type) {
            case CARD -> {
                BusinessCard card = new BusinessCard();
                card.setId(cardId); card.setUserId(owner); card.setImageUrl("/uploads/old.jpg");
                when(cards.findById(cardId)).thenReturn(Optional.of(card));
                yield card;
            }
            case POSTER -> {
                Poster poster = new Poster();
                poster.setId(1); poster.setUserId(owner); poster.setParsedJson(json("/uploads/old.jpg"));
                when(posters.findByIdAndUserId(1, owner)).thenReturn(Optional.of(poster));
                yield poster;
            }
            case TICKET -> {
                Ticket ticket = new Ticket();
                ticket.setId(1); ticket.setUserId(owner); ticket.setParsedJson(json("/uploads/old.jpg"));
                when(tickets.findByIdAndUserId(1, owner)).thenReturn(Optional.of(ticket));
                yield ticket;
            }
            case RECEIPT -> {
                Receipt receipt = new Receipt();
                receipt.setId(1); receipt.setUserId(owner); receipt.setParsedJson(json("/uploads/old.jpg"));
                when(receipts.findByIdAndUserId(1, owner)).thenReturn(Optional.of(receipt));
                yield receipt;
            }
        };
    }

    private void save(Type type, StoredImageService service, String reference) {
        switch (type) {
            case CARD -> new CardService(cards, groups, embedding, service).save(owner, cardRequest(reference));
            case POSTER -> new PosterService(posters, embedding, service).save(owner, posterRequest(reference));
            case TICKET -> new TicketService(tickets, embedding, service).save(owner, ticketRequest(reference));
            case RECEIPT -> new ReceiptService(receipts, embedding, service).save(owner, receiptRequest(reference));
        }
    }

    private void update(Type type, StoredImageService service, String reference) {
        switch (type) {
            case CARD -> new CardService(cards, groups, embedding, service).update(owner, cardId, cardRequest(reference));
            case POSTER -> new PosterService(posters, embedding, service).update(owner, 1, posterRequest(reference));
            case TICKET -> new TicketService(tickets, embedding, service).update(owner, 1, ticketRequest(reference));
            case RECEIPT -> new ReceiptService(receipts, embedding, service).update(owner, 1, receiptRequest(reference));
        }
    }

    private void delete(Type type) {
        switch (type) {
            case CARD -> new CardService(cards, groups, embedding, images).delete(owner, cardId);
            case POSTER -> new PosterService(posters, embedding, images).delete(owner, 1);
            case TICKET -> new TicketService(tickets, embedding, images).delete(owner, 1);
            case RECEIPT -> new ReceiptService(receipts, embedding, images).delete(owner, 1);
        }
    }

    private String json(String reference) { return "{\"image_url\":\"" + reference + "\"}"; }
    private CardSaveRequest cardRequest(String reference) {
        CardSaveRequest request = new CardSaveRequest(); request.setImageUrl(reference); return request;
    }
    private PosterRequest posterRequest(String reference) {
        PosterRequest request = new PosterRequest(); request.setParsedJson(json(reference)); return request;
    }
    private TicketRequest ticketRequest(String reference) {
        TicketRequest request = new TicketRequest(); request.setParsedJson(json(reference)); return request;
    }
    private ReceiptSaveRequest receiptRequest(String reference) {
        ReceiptSaveRequest request = new ReceiptSaveRequest(); request.setParsedJson(json(reference)); return request;
    }
}
