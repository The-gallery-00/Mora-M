package com.mora.controller;

import com.mora.dto.ApiResponse;
import com.mora.dto.PosterResponse;
import com.mora.dto.PosterRequest;
import com.mora.security.JwtUtil;
import com.mora.service.PosterService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/posters")
public class PosterController {

    private final PosterService posterService;
    private final JwtUtil jwtUtil;

    public PosterController(PosterService posterService, JwtUtil jwtUtil) {
        this.posterService = posterService;
        this.jwtUtil = jwtUtil;
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

    @PostMapping("/save")
    public ResponseEntity<ApiResponse<PosterResponse>> save(
            HttpServletRequest request,
            @RequestBody PosterRequest body) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            return ResponseEntity.ok(ApiResponse.ok(posterService.save(userId, body)));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    // GET /api/posters?page=0&size=10
    @GetMapping
    public ResponseEntity<ApiResponse<Page<PosterResponse>>> list(
            HttpServletRequest request,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "10") int size) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            return ResponseEntity.ok(ApiResponse.ok(posterService.listByUser(userId, page, size)));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<PosterResponse>> getById(
            HttpServletRequest request,
            @PathVariable Integer id) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            return ResponseEntity.ok(ApiResponse.ok(posterService.findById(userId, id)));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<PosterResponse>> update(
            HttpServletRequest request,
            @PathVariable Integer id,
            @RequestBody PosterRequest body) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            return ResponseEntity.ok(ApiResponse.ok(posterService.update(userId, id, body)));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(HttpServletRequest request, @PathVariable Integer id) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            posterService.delete(userId, id);
            return ResponseEntity.ok(ApiResponse.ok(null));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    // 하이브리드 검색: fuzzy*0.6 + vector*0.4
    @GetMapping("/search")
    public ResponseEntity<ApiResponse<List<PosterResponse>>> search(
            HttpServletRequest request,
            @RequestParam("q") String query,
            @RequestParam(value = "topK", defaultValue = "5") int topK) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            return ResponseEntity.ok(ApiResponse.ok(posterService.hybridSearch(userId, query, topK)));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }
}
