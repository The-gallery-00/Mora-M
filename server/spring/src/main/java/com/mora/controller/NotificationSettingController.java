package com.mora.controller;

import com.mora.dto.*;
import com.mora.security.JwtUtil;
import com.mora.service.NotificationSettingService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/api/notification-settings")
public class NotificationSettingController {
    private final NotificationSettingService service;
    private final JwtUtil jwtUtil;
    public NotificationSettingController(NotificationSettingService service, JwtUtil jwtUtil) { this.service = service; this.jwtUtil = jwtUtil; }

    @GetMapping public ResponseEntity<ApiResponse<NotificationSettingResponse>> get(HttpServletRequest request) {
        UUID userId = userId(request); if (userId == null) return unauthorized();
        return ResponseEntity.ok(ApiResponse.ok(NotificationSettingResponse.from(service.findOrCreate(userId))));
    }
    @PutMapping public ResponseEntity<ApiResponse<NotificationSettingResponse>> update(
            HttpServletRequest request, @RequestBody NotificationSettingRequest body) {
        UUID userId = userId(request); if (userId == null) return unauthorized();
        try { return ResponseEntity.ok(ApiResponse.ok(service.update(userId, body))); }
        catch (IllegalArgumentException e) { return ResponseEntity.badRequest().body(ApiResponse.fail("Reminder days must be between 0 and 30")); }
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
