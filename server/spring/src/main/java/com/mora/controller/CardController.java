package com.mora.controller;

import com.mora.dto.ApiResponse;
import com.mora.dto.CardMoveGroupRequest;
import com.mora.dto.CardResponse;
import com.mora.dto.CardSaveRequest;
import com.mora.security.JwtUtil;
import com.mora.service.CardService;
import com.mora.service.OcrService;
import com.mora.service.OcrUpstreamException;
import com.mora.service.SearchHistoryService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
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
    //
    // 업스트림(Python OCR) 실패는 500으로 뭉개지 않는다. 예전에는 전부 500 "OCR processing failed"
    // 였고, 앱은 SCF-09 "서버 에러 (500)" 만 띄웠다 — OCR 인스턴스가 죽어 503이 나던 실제 원인이
    // 앱까지 하나도 전달되지 않았다.
    //
    // ── /api/scan 최종 상태 매핑표 (앱의 mapFailure 가 이 표에 맞춰져 있어야 한다) ───────────
    //  업스트림에서 벌어진 일                      | Kind                  | 응답 상태 | 응답 error 본문
    //  ───────────────────────────────────────────┼───────────────────────┼──────────┼──────────────────────────────────────
    //  OCR 이 5xx 로 **응답** (503=인스턴스 사망,  | UPSTREAM_SERVER_ERROR |   502    | "OCR upstream failed (503)"
    //   500=추론 실패, 502=게이트웨이)             |                       |          |  ← 괄호 안은 업스트림 실제 코드
    //  OCR 이 4xx 로 **응답** (422=multipart 계약  | UPSTREAM_CLIENT_ERROR |   500    | "OCR upstream contract error (422)"
    //   위반, 400/404/413 등)                       |                       |          |
    //  **연결 불가** (DNS 실패·연결 거부·          | UNREACHABLE           |   503    | "OCR upstream unreachable"
    //   라우팅 없음·connect 타임아웃)              |                       |          |
    //  **read 타임아웃** (연결은 됐는데 90초 안에  | TIMEOUT               |   504    | "OCR upstream timeout"
    //   응답 없음)                                  |                       |          |
    //  그 외 예기치 못한 실패 (파일 읽기 오류 등)  | (예외 자체가 다름)     |   500    | "OCR processing failed"
    //
    // [연결 불가(503)와 타임아웃(504)을 가른 이유 — 직전 라운드가 만든 회귀]
    // 직전까지는 응답 없는 실패를 전부 504 "OCR upstream timeout" 으로 냈고, 앱은 이를
    // SCF-08 "문서를 읽는 데 **시간이 너무 오래 걸립니다** / 잠시 후 다시 시도" 로 안내했다.
    // 그런데 그 칸에는 UnknownHostException(DNS 없음)·ConnectException(연결 거부)까지 섞여 있었다.
    // OCR_SERVICE_URL 이 삭제된 서비스를 가리키면 Spring 은 **50ms** 만에 실패하는데 앱은
    // "시간이 오래 걸린다"고 말하고 재시도 버튼을 줬다 — 시간도 거짓이고, 재시도로 절대 풀리지도
    // 않는 **이중 거짓 신호**였다. 지금은 성질이 정반대인 둘을 503/504 로 갈라 보낸다.
    //  · 503 = 배포/설정이 잘못됐다. 사용자가 재시도해도 소용없다.
    //  · 504 = 붙긴 했는데 시간 안에 답이 없었다. 콜드스타트/과부하라면 재시도가 정당하다.
    // 갈라내는 판정은 OcrService.classifyIoFailure() 에 있다(cause 사슬 검사).
    //
    // [4xx 를 502 로 접지 않는 이유]
    // 처음에는 상태코드가 있는 실패를 4xx/5xx 구분 없이 전부 502로 접었다. 그런데 앱은 502를
    // SCF-07 "OCR 서버에 연결할 수 없습니다." + [다시 시도] 로 안내한다. multipart 파트명이 어긋나
    // FastAPI 가 422를 내면 앱은 "서버가 죽었다"고 말하며 재시도 버튼을 주고, 사용자가 몇 번을
    // 눌러도 같은 422가 반복된다 — 역시 재시도로 풀리지 않는 실패에 재시도를 권하는 거짓 신호다.
    // 4xx 는 Spring↔OCR 계약 위반, 즉 고칠 주체가 사용자가 아니라 서버 코드이므로
    // "서버 내부 오류"인 500 이 정확하다. 다만 본문에 업스트림 숫자를 남겨 진단은 가능하게 둔다.
    //
    // 본문에는 업스트림 상태코드 **숫자만** 넣는다. 예외 원문·URL·파일명은 넣지 않는다
    // (application.yml 의 server.error.include-*: never 와 같은 정보 은닉 선 — 3efa5b7).
    // 스택트레이스는 OcrService 가 이미 서버 로그에 남겼다.
    //
    // document_type 은 **선택 파라미터**다. 이 값을 보내지 않는 구버전 앱은 종전과 똑같이
    // 동작해야 하므로 required=false 이고, 기본값도 여기서 채우지 않는다 — 기본값의 정본은
    // OCR 의 Form("BUSINESS_CARD") 한 곳이다. 여기에 defaultValue 를 적으면 두 곳이 갈라진다.
    @PostMapping("/scan")
    public ResponseEntity<ApiResponse<Map<String, Object>>> scan(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "document_type", required = false) String documentType) {
        try {
            Map<String, Object> result = ocrService.scan(file, documentType);
            return ResponseEntity.ok(ApiResponse.ok(result));
        } catch (OcrUpstreamException e) {
            // if 사슬 대신 **switch 식**을 쓴다. 갈래를 하나 빠뜨리면 조용히 마지막 else 로
            // 떨어져 엉뚱한 문구가 나가는데(위 회귀가 정확히 그렇게 생겼다), switch 식은
            // enum 상수를 하나라도 놓치면 **컴파일이 깨진다.** 거짓 신호보다 빌드 실패가 낫다.
            return switch (e.getKind()) {
                // 업스트림이 죽었거나 추론에 실패했다. 시간이 지나면 풀릴 수 있으니 재시도 안내가 정당하다.
                case UPSTREAM_SERVER_ERROR -> ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                        .body(ApiResponse.<Map<String, Object>>fail(
                                "OCR upstream failed (" + e.getUpstreamStatus() + ")"));
                // Spring 이 보낸 요청 자체가 계약을 위반했다. 재시도해도 같은 코드가 반복된다.
                case UPSTREAM_CLIENT_ERROR -> ResponseEntity.internalServerError()
                        .body(ApiResponse.<Map<String, Object>>fail(
                                "OCR upstream contract error (" + e.getUpstreamStatus() + ")"));
                // 애초에 붙지 못했다. 시간의 문제가 아니라 주소/방화벽/배포의 문제다.
                case UNREACHABLE -> ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                        .body(ApiResponse.<Map<String, Object>>fail("OCR upstream unreachable"));
                // 붙었는데 read 상한(90초) 안에 응답이 오지 않았다.
                case TIMEOUT -> ResponseEntity.status(HttpStatus.GATEWAY_TIMEOUT)
                        .body(ApiResponse.<Map<String, Object>>fail("OCR upstream timeout"));
            };
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
