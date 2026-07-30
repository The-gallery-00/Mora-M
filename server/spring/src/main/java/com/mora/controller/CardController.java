package com.mora.controller;

import com.mora.dto.ApiResponse;
import com.mora.dto.CardResponse;
import com.mora.dto.CardSaveRequest;
import com.mora.security.JwtUtil;
import com.mora.service.CardService;
import com.mora.service.OcrService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * ═══════════════════════════════════════════════════════════════
 * CardController — 명함 관련 REST API 컨트롤러
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 명함 OCR 스캔, 저장, 목록 조회, 수정, 삭제, 유사도 검색 등
 * 명함 관리의 모든 HTTP 엔드포인트를 제공하는 컨트롤러이다.
 * 프론트엔드에서 /api/* 경로로 요청을 보내면 이 컨트롤러가 처리한다.
 *
 * [코드 흐름]
 * 1) OCR 스캔 (POST /api/scan):
 *    → MultipartFile 수신 → OcrService.scan() 호출 → OCR 결과 반환
 * 2) 명함 저장 (POST /api/save):
 *    → JWT 인증 확인 → CardSaveRequest 수신 → CardService.save() 호출
 * 3) 목록 조회 (GET /api/cards):
 *    → JWT 인증 확인 → CardService.listByUser() 호출 → 명함 리스트 반환
 * 4) 수정 (PUT /api/cards/{id}):
 *    → JWT 인증 확인 → CardService.update() 호출 → 수정된 명함 반환
 * 5) 삭제 (DELETE /api/cards/{id}):
 *    → JWT 인증 확인 → CardService.delete() 호출
 * 6) 검색 (GET /api/search?q=...&topK=...):
 *    → JWT 인증 확인 → CardService.search() 호출 → 유사도순 결과 반환
 *
 * [메서드 목록]
 * - getUserId(HttpServletRequest): Authorization 헤더에서 JWT로 userId를 추출하는 내부 유틸.
 * - scan(MultipartFile): 명함 이미지를 OCR 처리한다. POST /api/scan
 * - save(HttpServletRequest, CardSaveRequest): 명함을 저장한다. POST /api/save
 * - list(HttpServletRequest): 사용자의 명함 목록을 조회한다. GET /api/cards
 * - update(HttpServletRequest, UUID, CardSaveRequest): 명함을 수정한다. PUT /api/cards/{id}
 * - delete(HttpServletRequest, UUID): 명함을 삭제한다. DELETE /api/cards/{id}
 * - search(HttpServletRequest, String, int): 벡터 유사도 기반 검색. GET /api/search
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @RestController
 *   — @Controller + @ResponseBody. 반환값이 JSON으로 직렬화된다.
 *
 * @RequestMapping("/api")
 *   — 모든 엔드포인트에 "/api" 경로 접두사를 추가한다.
 *
 * @PostMapping, @GetMapping, @PutMapping, @DeleteMapping
 *   — 각각 HTTP POST, GET, PUT, DELETE 메서드를 처리한다.
 *
 * @RequestParam("file")
 *   — multipart/form-data 요청에서 "file" 파트를 MultipartFile로 바인딩한다.
 *
 * @RequestParam("q"), @RequestParam("topK")
 *   — URL 쿼리 파라미터를 메서드 파라미터에 바인딩한다.
 *     defaultValue로 기본값을 지정할 수 있다.
 *
 * @PathVariable
 *   — URL 경로의 {id} 부분을 메서드 파라미터에 바인딩한다.
 *
 * @RequestBody
 *   — JSON 요청 바디를 Java 객체로 역직렬화한다.
 *
 * ResponseEntity<T>
 *   — HTTP 상태 코드와 바디를 명시적으로 구성한다.
 *     status(401): 인증 필요, internalServerError(): 500 에러.
 *
 * MultipartFile (Spring Web)
 *   — 업로드된 파일을 나타내는 인터페이스.
 * ───────────────────────────────────────────
 */
@RestController
@RequestMapping("/api")
public class CardController {

    private final CardService cardService;
    private final OcrService ocrService;
    private final JwtUtil jwtUtil;

    public CardController(CardService cardService, OcrService ocrService, JwtUtil jwtUtil) {
        this.cardService = cardService;
        this.ocrService = ocrService;
        this.jwtUtil = jwtUtil;
    }

    /**
     * Authorization 헤더에서 JWT 토큰을 추출하여 사용자 UUID를 반환한다.
     * 토큰이 없거나 유효하지 않으면 null을 반환한다.
     */
    private UUID getUserId(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) return null;
        try {
            return jwtUtil.getUserId(header.substring(7));  // "Bearer " 제거 후 파싱
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 명함 이미지를 OCR 서버에 보내 문자 인식을 수행한다.
     * 인증 불필요 — 비회원도 OCR 스캔 가능.
     */
    @PostMapping("/scan")
    public ResponseEntity<ApiResponse<Map<String, Object>>> scan(@RequestParam("file") MultipartFile file) {
        try {
            Map<String, Object> result = ocrService.scan(file);
            return ResponseEntity.ok(ApiResponse.ok(result));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    /**
     * OCR 인식 결과를 명함으로 저장한다.
     * 로그인 필수 — JWT 토큰에서 userId를 추출하여 명함 소유자를 설정한다.
     */
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
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    /**
     * 현재 사용자의 명함 목록을 최신순으로 조회한다.
     * 로그인 필수.
     */
    @GetMapping("/cards")
    public ResponseEntity<ApiResponse<List<CardResponse>>> list(HttpServletRequest request) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            List<CardResponse> cards = cardService.listByUser(userId);
            return ResponseEntity.ok(ApiResponse.ok(cards));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    /**
     * 특정 명함의 정보를 수정한다.
     * 로그인 필수. 본인 소유 명함만 수정 가능.
     */
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
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    /**
     * 특정 명함을 삭제한다.
     * 로그인 필수. 본인 소유 명함만 삭제 가능.
     */
    @DeleteMapping("/cards/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(HttpServletRequest request, @PathVariable UUID id) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            cardService.delete(userId, id);
            return ResponseEntity.ok(ApiResponse.ok(null));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }

    /**
     * 벡터 유사도 기반으로 명함을 검색한다.
     * 검색 쿼리(q)를 임베딩으로 변환하여 코사인 유사도가 높은 명함을 반환한다.
     * 로그인 필수.
     *
     * @param query 검색 키워드 (예: "삼성전자 개발자")
     * @param topK  반환할 최대 결과 수 (기본값: 5)
     */
    @GetMapping("/search")
    public ResponseEntity<ApiResponse<List<CardResponse>>> search(
            HttpServletRequest request,
            @RequestParam("q") String query,
            @RequestParam(value = "topK", defaultValue = "5") int topK) {
        try {
            UUID userId = getUserId(request);
            if (userId == null) return ResponseEntity.status(401).body(ApiResponse.fail("Login required"));
            List<CardResponse> results = cardService.search(userId, query, topK);
            return ResponseEntity.ok(ApiResponse.ok(results));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(ApiResponse.fail(e.getMessage()));
        }
    }
}
