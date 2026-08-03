package com.mora.controller;

import com.mora.dto.ApiResponse;
import com.mora.dto.NotificationResponse;
import com.mora.security.JwtUtil;
import com.mora.service.NotificationService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    private final NotificationService service;
    private final JwtUtil jwtUtil;
    public NotificationController(NotificationService service, JwtUtil jwtUtil) { this.service = service; this.jwtUtil = jwtUtil; }

    @GetMapping public ResponseEntity<ApiResponse<Page<NotificationResponse>>> list(
            HttpServletRequest request, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        UUID userId = userId(request); if (userId == null) return unauthorized();
        return ResponseEntity.ok(ApiResponse.ok(service.list(userId, page, size)));
    }
    @GetMapping("/unread-count") public ResponseEntity<ApiResponse<Map<String, Long>>> unread(HttpServletRequest request) {
        UUID userId = userId(request); if (userId == null) return unauthorized();
        return ResponseEntity.ok(ApiResponse.ok(service.unreadCount(userId)));
    }
    @PatchMapping("/{id}/read") public ResponseEntity<ApiResponse<NotificationResponse>> read(
            HttpServletRequest request, @PathVariable UUID id) {
        UUID userId = userId(request); if (userId == null) return unauthorized();
        try { return ResponseEntity.ok(ApiResponse.ok(service.markRead(userId, id))); }
        catch (IllegalArgumentException e) { return ResponseEntity.badRequest().body(ApiResponse.fail("Notification not found")); }
    }
    @PatchMapping("/read-all") public ResponseEntity<ApiResponse<Map<String, Long>>> readAll(HttpServletRequest request) {
        UUID userId = userId(request); if (userId == null) return unauthorized();
        return ResponseEntity.ok(ApiResponse.ok(service.markAllRead(userId)));
    }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(
            HttpServletRequest request, @PathVariable UUID id) {
        UUID userId = userId(request); if (userId == null) return unauthorized();
        try { service.delete(userId, id); return ResponseEntity.ok(ApiResponse.ok(null)); }
        catch (IllegalArgumentException e) { return ResponseEntity.badRequest().body(ApiResponse.fail("Notification not found")); }
    }
    @DeleteMapping public ResponseEntity<ApiResponse<Long>> deleteAll(HttpServletRequest request) {
        UUID userId = userId(request); if (userId == null) return unauthorized();
        return ResponseEntity.ok(ApiResponse.ok(service.deleteAll(userId)));
    }

    private UUID userId(HttpServletRequest request) {
        String h = request.getHeader("Authorization");
        try { return h != null && h.startsWith("Bearer ") ? jwtUtil.getUserId(h.substring(7)) : null; }
        catch (Exception ignored) { return null; }
    }
    private static <T> ResponseEntity<ApiResponse<T>> unauthorized() {
        return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
    }
}
