package com.mora.controller;

import com.mora.dto.*;
import com.mora.security.JwtUtil;
import com.mora.service.GoogleCalendarService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/google-calendar")
public class GoogleCalendarController {

    private final GoogleCalendarService calendarService;
    private final JwtUtil jwtUtil;

    public GoogleCalendarController(GoogleCalendarService calendarService, JwtUtil jwtUtil) {
        this.calendarService = calendarService;
        this.jwtUtil = jwtUtil;
    }

    @GetMapping("/connected/{userId}")
    public ResponseEntity<ApiResponse<CalendarConnectionResponse>> connected(
            HttpServletRequest request,
            @PathVariable UUID userId) {
        UUID requesterId = getUserId(request);
        if (!userId.equals(requesterId)) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
        return ResponseEntity.ok(ApiResponse.ok(calendarService.connected(userId)));
    }

    @GetMapping("/tokens/{userId}")
    public ResponseEntity<ApiResponse<CalendarTokenResponse>> tokens(
            HttpServletRequest request,
            @PathVariable UUID userId) {
        try {
            UUID requesterId = getUserId(request);
            if (!userId.equals(requesterId)) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            return ResponseEntity.ok(ApiResponse.ok(calendarService.tokenInfo(userId)));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail(e.getMessage()));
        }
    }

    @GetMapping("/connect-url")
    public ResponseEntity<ApiResponse<Map<String, String>>> connectUrl(HttpServletRequest request) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            return ResponseEntity.ok(ApiResponse.ok(calendarService.connectUrl(userId)));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail(e.getMessage()));
        }
    }

    @DeleteMapping("/tokens/{userId}")
    public ResponseEntity<ApiResponse<CalendarConnectionResponse>> disconnect(
            HttpServletRequest request,
            @PathVariable UUID userId) {
        try {
            UUID requesterId = getUserId(request);
            if (!userId.equals(requesterId)) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            return ResponseEntity.ok(ApiResponse.ok(calendarService.disconnect(userId)));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail(e.getMessage()));
        }
    }

    @GetMapping("/month")
    public ResponseEntity<ApiResponse<GoogleCalendarMonthResponse>> month(
            HttpServletRequest request,
            @RequestParam UUID userId,
            @RequestParam int year,
            @RequestParam int month) {
        UUID requesterId = getUserId(request);
        if (!userId.equals(requesterId)) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
        return ResponseEntity.ok(ApiResponse.ok(calendarService.month(userId, year, month)));
    }

    private UUID getUserId(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) return null;
        try {
            return jwtUtil.getUserId(header.substring(7));
        } catch (Exception e) {
            return null;
        }
    }
}
