package com.mora.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mora.entity.StoredImage;
import com.mora.repository.StoredImageRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class StoredImageServiceTest {
    private final UUID owner = UUID.randomUUID();
    private final UUID other = UUID.randomUUID();
    private final StoredImageRepository repository = mock(StoredImageRepository.class);
    private final OcrService ocr = mock(OcrService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final StoredImageDeletionService deletions = mock(StoredImageDeletionService.class);
    private final StoredImageService service = new StoredImageService(repository, ocr, jdbc, mapper, deletions,
            new StoredImageRegistrationService(repository, jdbc, deletions));
    private final StoredImage image = new StoredImage("a.jpg", owner);

    @BeforeEach
    void setUp() {
        when(jdbc.queryForList(anyString(), eq(UUID.class), any(Object[].class))).thenReturn(List.of(owner));
        when(repository.findById("a.jpg")).thenReturn(Optional.of(image));
    }

    @Test
    void ownerReadsByRegistryOnlyAndOtherUserCannotFetch() {
        ResponseEntity<byte[]> response = ResponseEntity.ok(new byte[]{1, 2});
        when(ocr.fetchImage("a.jpg")).thenReturn(response);
        assertSame(response, service.readImage(owner, "a.jpg"));
        assertEquals(404, assertThrows(ResponseStatusException.class,
                () -> service.readImage(other, "a.jpg")).getStatusCode().value());
        verify(ocr, times(1)).fetchImage("a.jpg");
        verifyNoInteractions(jdbc);
    }

    @Test
    void guessedNameCannotBeAttachedOrRegisteredThroughNormalization() {
        assertThrows(ResponseStatusException.class,
                () -> service.normalizeOwnedReference(other, "/uploads/a.jpg"));
        assertThrows(ResponseStatusException.class,
                () -> service.normalizeOwnedJson(other, "{\"imageUrl\":\"/uploads/a.jpg\"}"));
        assertThrows(ResponseStatusException.class,
                () -> service.normalizeOwnedReference(owner, "/uploads/unknown.jpg"));
        verify(repository, never()).save(any());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
        verifyNoInteractions(ocr);
    }

    @Test
    void trustedRegistrationNeverTransfersExistingOwnership() {
        service.registerUpload(owner, "https://legacy.example/uploads/a.jpg");
        assertThrows(ResponseStatusException.class, () -> service.registerUpload(other, "/uploads/a.jpg"));
        verify(jdbc, times(2)).update(contains("ON CONFLICT (image_name) DO NOTHING"),
                eq("a.jpg"), any(UUID.class));
        verify(repository, never()).save(any());
        verifyNoInteractions(ocr);
    }

    @Test
    void missingOwnerCompensatesOnlyUnregisteredServerUpload() {
        when(jdbc.queryForList(anyString(), eq(UUID.class), any(Object[].class))).thenReturn(List.of());
        when(deletions.enqueueUnclaimed("new.jpg")).thenReturn(true);
        assertThrows(ResponseStatusException.class, () -> service.registerUpload(owner, "/uploads/new.jpg"));
        verify(deletions).deleteQueued("new.jpg");
        assertThrows(ResponseStatusException.class, () -> service.registerUpload(other, "/uploads/a.jpg"));
        verify(deletions, never()).deleteQueued("a.jpg");
        verifyNoInteractions(ocr);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void uploadRegistrationRequiresNonemptyValidReferenceAndOwner() {
        for (String reference : new String[]{null, "", " "}) {
            assertThrows(ResponseStatusException.class, () -> service.registerUpload(owner, reference));
        }
        assertThrows(ResponseStatusException.class, () -> service.registerUpload(null, "/uploads/a.jpg"));
        verifyNoInteractions(ocr);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void filenameLengthMatchesOcrBoundary() {
        String maximum = "a".repeat(200);
        when(repository.findById(maximum)).thenReturn(Optional.of(new StoredImage(maximum, owner)));
        assertEquals("/uploads/" + maximum, service.normalizeOwnedReference(owner, "/uploads/" + maximum));
        assertThrows(ResponseStatusException.class,
                () -> service.normalizeOwnedReference(owner, "/uploads/" + maximum + "a"));
    }

    @Test
    void canonicalizesBothKeysInObjectsArraysAndEncodedLegacyObjects() throws Exception {
        String json = "{\"imageUrl\":\"https://legacy.example/uploads/a.jpg\","
                + "\"blocks\":[{\"image_url\":\"/uploads/a.jpg\"}],\"text\":\"hello\"}";
        String normalized = service.normalizeOwnedJson(owner, mapper.writeValueAsString(json));
        assertEquals("/uploads/a.jpg", mapper.readTree(normalized).path("imageUrl").textValue());
        assertEquals("/uploads/a.jpg", mapper.readTree(normalized).path("blocks").get(0).path("image_url").textValue());
        assertEquals(Set.of("/uploads/a.jpg"), service.referencesInJson(normalized, "[]"));
        assertEquals("[]", service.normalizeOwnedJson(owner, "[]"));
    }

    @Test
    void secondAliasCannotHideForgedReference() {
        assertThrows(ResponseStatusException.class, () -> service.normalizeOwnedJson(owner,
                "{\"imageUrl\":\"/uploads/a.jpg\",\"image_url\":\"/uploads/victim.jpg\"}"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"../a.jpg", "/uploads/../a.jpg", "/uploads/a/b.jpg", "/uploads/%61.jpg",
            "/uploads/a.jpg?x=1", "/uploads/a.jpg#x", "file:///uploads/a.jpg",
            "https://user@host/uploads/a.jpg", "//host/uploads/a.jpg", "https://host/other/a.jpg",
            "/uploads/a..jpg", "/uploads/a\\b.jpg", "uploads/a.jpg", " "})
    void rejectsUnsafeReferencesWithoutFetching(String reference) {
        assertThrows(ResponseStatusException.class, () -> service.normalizeOwnedReference(owner, reference));
        verifyNoInteractions(ocr);
    }

    @ParameterizedTest
    @ValueSource(strings = {"42", "true", "\"not json\"", "{broken", "{\"imageUrl\":42}",
            "{\"image_url\":{}}", "{\"imageUrl\":null,\"imageUrl\":\"/uploads/a.jpg\"}", "{} {}"})
    void rejectsUnsupportedOrAmbiguousJson(String json) {
        assertThrows(ResponseStatusException.class, () -> service.normalizeOwnedJson(owner, json));
        verifyNoInteractions(ocr);
    }

    @Test
    void absenceOfImageIsSupported() {
        assertNull(service.normalizeOwnedReference(owner, null));
        assertEquals("", service.normalizeOwnedReference(owner, ""));
        assertEquals("{\"imageUrl\":null,\"image_url\":\"\"}", service.normalizeOwnedJson(owner,
                "{\"imageUrl\":null,\"image_url\":\"\"}"));
        assertNull(service.normalizeOwnedJson(owner, " "));
    }

    @Test
    void sharedImageSurvivesUntilLastReferenceIsRemoved() {
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(true, false);
        service.deleteIfUnreferenced(owner, "/uploads/a.jpg");
        verifyNoInteractions(ocr);
        service.deleteIfUnreferenced(owner, "https://old.example/uploads/a.jpg");
        verify(ocr).deleteImage("a.jpg");
        verify(repository).delete(image);
        verify(repository).flush();
    }

    @Test
    void failedUpstreamDeletionKeepsRegistryForRetry() {
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(false);
        doThrow(new RuntimeException("upstream unavailable")).doNothing().when(ocr).deleteImage("a.jpg");
        assertThrows(RuntimeException.class, () -> service.deleteIfUnreferenced(owner, "/uploads/a.jpg"));
        verify(repository, never()).delete(any());
        service.deleteIfUnreferenced(owner, "/uploads/a.jpg");
        verify(repository).delete(image);
        verify(ocr, times(2)).deleteImage("a.jpg");
    }

    @Test
    void bulkDeletionIncludesAllRegistryEntriesIncludingUnattachedUploads() {
        StoredImage pending = new StoredImage("pending.jpg", owner);
        when(repository.findByUserIdOrderByImageName(owner)).thenReturn(List.of(image, pending));
        service.deleteAll(owner);
        var order = inOrder(ocr, repository);
        order.verify(ocr).deleteImage("a.jpg");
        order.verify(repository).delete(image);
        order.verify(ocr).deleteImage("pending.jpg");
        order.verify(repository).delete(pending);
        order.verify(repository).flush();
    }

    @Test
    void unauthorizedDeleteCannotTouchUpstream() {
        assertThrows(ResponseStatusException.class, () -> service.deleteIfUnreferenced(other, "/uploads/a.jpg"));
        verifyNoInteractions(ocr);
        verify(repository, never()).delete(any());
    }
}
