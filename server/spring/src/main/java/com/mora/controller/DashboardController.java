package com.mora.controller;

import com.mora.dto.ApiResponse;
import com.mora.dto.DashboardResponse;
import com.mora.security.JwtUtil;
import com.mora.service.DashboardService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.UUID;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {
    private final DashboardService service;
    private final JwtUtil jwtUtil;
    public DashboardController(DashboardService service, JwtUtil jwtUtil) { this.service = service; this.jwtUtil = jwtUtil; }

    @GetMapping
    public ResponseEntity<ApiResponse<DashboardResponse>> get(
            HttpServletRequest request,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(defaultValue = "30") int deadlineDays) {
        UUID userId = userId(request);
        if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
        return ResponseEntity.ok(ApiResponse.ok(service.get(userId, date, deadlineDays)));
    }

    private UUID userId(HttpServletRequest request) {
        String h = request.getHeader("Authorization");
        try { return h != null && h.startsWith("Bearer ") ? jwtUtil.getUserId(h.substring(7)) : null; }
        catch (Exception ignored) { return null; }
    }
}
