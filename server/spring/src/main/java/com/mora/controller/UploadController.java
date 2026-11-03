package com.mora.controller;

import com.mora.dto.ApiResponse;
import com.mora.repository.UserRepository;
import com.mora.security.JwtUtil;
import com.mora.service.OcrService;
import com.mora.service.OcrUpstreamException;
import com.mora.service.StoredImageService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.UUID;

@RestController
public class UploadController {
    private final StoredImageService images;
    private final OcrService ocr;
    private final JwtUtil jwt;
    private final UserRepository users;

    public UploadController(StoredImageService images, OcrService ocr, JwtUtil jwt, UserRepository users) {
        this.images = images;
        this.ocr = ocr;
        this.jwt = jwt;
        this.users = users;
    }

    @GetMapping("/uploads/{imageName}")
    public ResponseEntity<?> image(HttpServletRequest request, @PathVariable String imageName) {
        UUID owner = userId(request);
        if (owner == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
        try {
            ResponseEntity<byte[]> upstream = images.readImage(owner, imageName);
            MediaType type = upstream.getHeaders().getContentType();
            if (type == null || !type.getType().equals("image")) type = MediaType.APPLICATION_OCTET_STREAM;
            return ResponseEntity.ok()
                    .contentType(type)
                    .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                    .header(HttpHeaders.VARY, "Authorization")
                    .header("X-Content-Type-Options", "nosniff")
                    .body(upstream.getBody());
        } catch (ResponseStatusException e) {
            return ResponseEntity.status(e.getStatusCode()).body(ApiResponse.fail("Image not available"));
        } catch (RestClientResponseException e) {
            int status = e.getStatusCode().value() == 404 ? 404 : 502;
            return ResponseEntity.status(status).body(ApiResponse.fail("Image not available"));
        } catch (RuntimeException e) {
            return ResponseEntity.status(502).body(ApiResponse.fail("Image not available"));
        }
    }

    @PostMapping("/api/commit")
    public ResponseEntity<ApiResponse<Map<String, Object>>> commit(
            HttpServletRequest request, @RequestParam("file") MultipartFile file,
            @RequestParam(value = "document_type", defaultValue = "ETC") String type,
            @RequestParam(value = "raw_blocks", defaultValue = "[]") String blocks,
            @RequestParam(value = "corrected_fields", defaultValue = "{}") String fields) {
        UUID owner = userId(request);
        if (owner == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
        if (blocks.length() + fields.length() > 256_000) {
            return ResponseEntity.status(413).body(ApiResponse.fail("OCR metadata too large"));
        }
        try {
            Map<String, Object> result = ocr.commit(file, type, blocks, fields);
            if (result == null || !Boolean.TRUE.equals(result.get("success"))
                    || !(result.get("data") instanceof Map<?, ?> data)
                    || !(data.get("image_url") instanceof String imageUrl) || imageUrl.isBlank()) {
                return ResponseEntity.status(502).body(ApiResponse.fail("Invalid OCR response"));
            }
            images.registerUpload(owner, imageUrl);
            // Preserve the envelope expected by the app's commit parser.
            return ResponseEntity.ok(ApiResponse.ok(dataMap(result)));
        } catch (OcrUpstreamException e) {
            int status = switch (e.getKind()) {
                case TIMEOUT -> 504;
                case UNREACHABLE -> 503;
                default -> 502;
            };
            return ResponseEntity.status(status).body(ApiResponse.fail("OCR commit failed"));
        } catch (RuntimeException e) {
            return ResponseEntity.status(502).body(ApiResponse.fail("OCR commit failed"));
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> dataMap(Map<String, Object> result) {
        return (Map<String, Object>) result.get("data");
    }

    private UUID userId(HttpServletRequest request) {
        String h = request.getHeader(HttpHeaders.AUTHORIZATION);
        UUID id;
        try {
            if (h == null || !h.startsWith("Bearer ")) return null;
            id = jwt.getUserId(h.substring(7));
        } catch (RuntimeException e) {
            return null;
        }
        // A DB outage is a server error, not an expired session.
        return users.existsById(id) ? id : null;
    }
}
