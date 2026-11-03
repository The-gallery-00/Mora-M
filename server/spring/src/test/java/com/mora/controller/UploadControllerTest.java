package com.mora.controller;

import com.mora.repository.UserRepository;
import com.mora.security.JwtUtil;
import com.mora.service.OcrService;
import com.mora.service.StoredImageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class UploadControllerTest {
    private final StoredImageService images = mock(StoredImageService.class);
    private final OcrService ocr = mock(OcrService.class);
    private final UserRepository users = mock(UserRepository.class);
    private final JwtUtil jwt = new JwtUtil("test-only-secret-that-is-at-least-32-characters", 120_000);
    private final UUID user = UUID.randomUUID();
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new UploadController(images, ocr, jwt, users)).build();
        when(users.existsById(user)).thenReturn(true);
    }

    @Test
    void noCredentialCannotReachImageOrCommit() throws Exception {
        mvc.perform(get("/uploads/mine.jpg")).andExpect(status().isUnauthorized());
        mvc.perform(multipart("/api/commit").file(file())).andExpect(status().isUnauthorized());
        verifyNoInteractions(images, ocr);
    }

    @Test
    void deletedUserCannotUseAnUnexpiredToken() throws Exception {
        when(users.existsById(user)).thenReturn(false);
        mvc.perform(get("/uploads/mine.jpg").header("Authorization", bearer())).andExpect(status().isUnauthorized());
        verifyNoInteractions(images, ocr);
    }

    @Test
    void imageResponseIsPrivateAndOwnershipFailureIsNotForwarded() throws Exception {
        when(images.readImage(user, "mine.jpg")).thenReturn(ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG).body(new byte[]{1, 2}));
        mvc.perform(get("/uploads/mine.jpg").header("Authorization", bearer()))
                .andExpect(status().isOk()).andExpect(content().bytes(new byte[]{1, 2}))
                .andExpect(header().string("Cache-Control", "private, no-store"))
                .andExpect(header().string("Vary", "Authorization"));
        when(images.readImage(user, "victim.jpg")).thenThrow(new ResponseStatusException(HttpStatus.NOT_FOUND));
        mvc.perform(get("/uploads/victim.jpg").header("Authorization", bearer())).andExpect(status().isNotFound());
        verifyNoInteractions(ocr);
    }

    @Test
    void commitRegistersOnlyUpstreamImageAndKeepsParserEnvelope() throws Exception {
        when(ocr.commit(any(), eq("RECEIPT"), eq("[]"), eq("{}")))
                .thenReturn(Map.of("success", true, "data", Map.of("image_url", "/uploads/new.jpg", "count", 2)));
        mvc.perform(multipart("/api/commit").file(file()).param("document_type", "RECEIPT")
                        .header("Authorization", bearer()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.image_url").value("/uploads/new.jpg"))
                .andExpect(jsonPath("$.data.count").value(2));
        verify(images).registerUpload(user, "/uploads/new.jpg");
    }

    @Test
    void malformedUpstreamResponseCannotCreateOwnership() throws Exception {
        when(ocr.commit(any(), any(), any(), any())).thenReturn(Map.of("success", false));
        mvc.perform(multipart("/api/commit").file(file()).header("Authorization", bearer()))
                .andExpect(status().isBadGateway());
        verifyNoInteractions(images);
    }

    private String bearer() { return "Bearer " + jwt.generateToken(user, "test@example.invalid"); }
    private MockMultipartFile file() { return new MockMultipartFile("file", "test.jpg", "image/jpeg", new byte[]{1}); }
}
