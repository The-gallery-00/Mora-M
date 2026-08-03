package com.mora.controller;

import com.mora.dto.ApiResponse;
import com.mora.dto.CardMoveGroupRequest;
import com.mora.dto.CardResponse;
import com.mora.dto.CardSaveRequest;
import com.mora.security.JwtUtil;
import com.mora.service.CardService;
import com.mora.service.OcrService;
import com.mora.service.SearchHistoryService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class CardController {

    private final CardService cardService;
    private final OcrService ocrService;
    private final JwtUtil jwtUtil;
    private final SearchHistoryService searchHistoryService;

    public CardController(CardService cardService, OcrService ocrService, JwtUtil jwtUtil, SearchHistoryService searchHistoryService) {
        this.cardService = cardService;
        this.ocrService = ocrService;
        this.jwtUtil = jwtUtil;
        this.searchHistoryService = searchHistoryService;
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

    // 비회원도 OCR 스캔 가능
    @PostMapping("/scan")
    public ResponseEntity<ApiResponse<Map<String, Object>>> scan(@RequestParam("file") MultipartFile file) {
        try {
            Map<String, Object> result = ocrService.scan(file);
            return ResponseEntity.ok(ApiResponse.ok(result));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail("OCR processing failed"));
        }
    }

    @PostMapping("/save")
    public ResponseEntity<ApiResponse<CardResponse>> save(
            HttpServletRequest request,
            @RequestBody CardSaveRequest body) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            CardResponse response = cardService.save(userId, body);
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail("Request failed"));
        }
    }

    // GET /api/cards?page=0&size=10&groupId=...&ungrouped=true
    @GetMapping("/cards")
    public ResponseEntity<ApiResponse<Page<CardResponse>>> list(
            HttpServletRequest request,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "10") int size,
            @RequestParam(value = "groupId", required = false) UUID groupId,
            @RequestParam(value = "ungrouped", defaultValue = "false") boolean ungrouped) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            Page<CardResponse> cards = cardService.listByUser(userId, page, size, groupId, ungrouped);
            return ResponseEntity.ok(ApiResponse.ok(cards));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    @GetMapping("/cards/{id}")
    public ResponseEntity<ApiResponse<CardResponse>> getById(
            HttpServletRequest request,
            @PathVariable UUID id) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            return ResponseEntity.ok(ApiResponse.ok(cardService.findById(userId, id)));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    @PutMapping("/cards/{id}")
    public ResponseEntity<ApiResponse<CardResponse>> update(
            HttpServletRequest request,
            @PathVariable UUID id,
            @RequestBody CardSaveRequest body) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            CardResponse response = cardService.update(userId, id, body);
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail("Request failed"));
        }
    }

    @PatchMapping("/cards/{id}/group")
    public ResponseEntity<ApiResponse<CardResponse>> moveGroup(
            HttpServletRequest request,
            @PathVariable UUID id,
            @RequestBody(required = false) CardMoveGroupRequest body) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            UUID groupId = body == null ? null : body.getGroupId();
            CardResponse response = cardService.moveGroup(userId, id, groupId);
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    @DeleteMapping("/cards/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(HttpServletRequest request, @PathVariable UUID id) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            cardService.delete(userId, id);
            return ResponseEntity.ok(ApiResponse.ok(null));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail("Request failed"));
        }
    }

    // 하이브리드 검색: fuzzy*0.6 + vector*0.4
    @GetMapping("/cards/search")
    public ResponseEntity<ApiResponse<List<CardResponse>>> search(
            HttpServletRequest request,
            @RequestParam("q") String query,
            @RequestParam(value = "topK", defaultValue = "5") int topK) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            searchHistoryService.record(userId, "BUSINESS_CARD", query);
            List<CardResponse> results = cardService.hybridSearch(userId, query, topK);
            return ResponseEntity.ok(ApiResponse.ok(results));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail("Request failed"));
        }
    }
}
