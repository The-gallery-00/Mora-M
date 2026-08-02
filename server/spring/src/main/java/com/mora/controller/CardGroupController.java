package com.mora.controller;

import com.mora.dto.ApiResponse;
import com.mora.dto.CardGroupRequest;
import com.mora.dto.CardGroupResponse;
import com.mora.security.JwtUtil;
import com.mora.service.CardGroupService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/card-groups")
public class CardGroupController {

    private final CardGroupService groupService;
    private final JwtUtil jwtUtil;

    public CardGroupController(CardGroupService groupService, JwtUtil jwtUtil) {
        this.groupService = groupService;
        this.jwtUtil = jwtUtil;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<CardGroupResponse>>> list(HttpServletRequest request) {
        UUID userId = getUserId(request);
        if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
        return ResponseEntity.ok(ApiResponse.ok(groupService.list(userId)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<CardGroupResponse>> create(
            HttpServletRequest request,
            @RequestBody CardGroupRequest body) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            return ResponseEntity.ok(ApiResponse.ok(groupService.create(userId, body.getName())));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail(e.getMessage()));
        }
    }

    @PatchMapping("/{id}")
    public ResponseEntity<ApiResponse<CardGroupResponse>> rename(
            HttpServletRequest request,
            @PathVariable UUID id,
            @RequestBody CardGroupRequest body) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            return ResponseEntity.ok(ApiResponse.ok(groupService.rename(userId, id, body.getName())));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail(e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(HttpServletRequest request, @PathVariable UUID id) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            groupService.delete(userId, id);
            return ResponseEntity.ok(ApiResponse.ok(null));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail(e.getMessage()));
        }
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
