package com.mora.controller;

import com.mora.dto.ApiResponse;
import com.mora.dto.SearchHistoryResponse;
import com.mora.security.JwtUtil;
import com.mora.service.SearchHistoryService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/search-histories")
public class SearchHistoryController {
    private final SearchHistoryService service;
    private final JwtUtil jwtUtil;
    public SearchHistoryController(SearchHistoryService service, JwtUtil jwtUtil) { this.service = service; this.jwtUtil = jwtUtil; }

    @GetMapping public ResponseEntity<ApiResponse<List<SearchHistoryResponse>>> list(HttpServletRequest request) {
        UUID userId = userId(request); if (userId == null) return unauthorized();
        return ResponseEntity.ok(ApiResponse.ok(service.list(userId)));
    }
    @DeleteMapping public ResponseEntity<ApiResponse<Long>> clear(HttpServletRequest request) {
        UUID userId = userId(request); if (userId == null) return unauthorized();
        return ResponseEntity.ok(ApiResponse.ok(service.clear(userId)));
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
