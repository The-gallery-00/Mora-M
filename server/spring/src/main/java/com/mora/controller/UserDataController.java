package com.mora.controller;

import com.mora.dto.ApiResponse;
import com.mora.dto.UserDataDeleteResponse;
import com.mora.security.JwtUtil;
import com.mora.service.UserDataService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/me/documents")
public class UserDataController {
    private final UserDataService service;
    private final JwtUtil jwtUtil;

    public UserDataController(UserDataService service, JwtUtil jwtUtil) {
        this.service = service;
        this.jwtUtil = jwtUtil;
    }

    @DeleteMapping
    public ResponseEntity<ApiResponse<UserDataDeleteResponse>> deleteAll(HttpServletRequest request) {
        UUID userId = userId(request);
        if (userId == null) return unauthorized();
        return ResponseEntity.ok(ApiResponse.ok(service.deleteAllDocuments(userId)));
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
