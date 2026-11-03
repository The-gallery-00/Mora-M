package com.mora.controller;

import com.mora.repository.UserRepository;
import com.mora.security.JwtUtil;
import com.mora.service.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ScanAuthorizationTest {
    @Test
    void anonymousScanIsDeniedBeforeUpstream() throws Exception {
        OcrService ocr = mock(OcrService.class);
        StoredImageService images = mock(StoredImageService.class);
        var controller = new CardController(mock(CardService.class), ocr, mock(JwtUtil.class),
                mock(SearchHistoryService.class), images, mock(UserRepository.class));
        MockMvcBuilders.standaloneSetup(controller).build()
                .perform(multipart("/api/scan").file(file()))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(ocr, images);
    }

    @Test
    void scanRegistersImageForAuthenticatedUserAndPreservesDoubleEnvelope() throws Exception {
        OcrService ocr = mock(OcrService.class);
        StoredImageService images = mock(StoredImageService.class);
        UserRepository users = mock(UserRepository.class);
        UUID owner = UUID.randomUUID();
        JwtUtil jwt = new JwtUtil("test-only-secret-that-is-at-least-32-characters", 120_000);
        when(users.existsById(owner)).thenReturn(true);
        when(ocr.scan(any(), eq("POSTER"))).thenReturn(Map.of("success", true,
                "data", Map.of("image_url", "/uploads/scan.jpg", "type", "POSTER")));
        var controller = new CardController(mock(CardService.class), ocr, jwt,
                mock(SearchHistoryService.class), images, users);
        MockMvcBuilders.standaloneSetup(controller).build()
                .perform(multipart("/api/scan").file(file()).param("document_type", "POSTER")
                        .header("Authorization", "Bearer " + jwt.generateToken(owner, "test@example.invalid")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.data.image_url").value("/uploads/scan.jpg"));
        verify(images).registerUpload(owner, "/uploads/scan.jpg");
    }

    private MockMultipartFile file() {
        return new MockMultipartFile("file", "scan.jpg", "image/jpeg", new byte[]{1});
    }
}
