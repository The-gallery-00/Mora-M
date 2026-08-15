package com.mora.controller;

import com.mora.dto.*;
import com.mora.entity.User;
import com.mora.security.JwtUtil;
import com.mora.security.PasswordChangeRateLimiter;
import com.mora.service.AuthService;
import com.mora.service.GoogleOAuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.UUID;

/**
 * ═══════════════════════════════════════════════════════════════
 * AuthController — 인증 관련 REST API 컨트롤러
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 회원가입, 로그인, 내 정보 조회 등 인증(Authentication) 관련
 * HTTP 엔드포인트를 제공하는 컨트롤러이다.
 * 프론트엔드에서 /auth/* 경로로 요청을 보내면 이 컨트롤러가 처리한다.
 *
 * [코드 흐름]
 * 1) 회원가입 (POST /auth/signup):
 *    → SignupRequest JSON 수신 → AuthService.signup() 호출
 *    → 성공 시 AuthResponse(토큰+사용자정보) 반환, 실패 시 에러 메시지 반환
 * 2) 로그인 (POST /auth/login):
 *    → LoginRequest JSON 수신 → AuthService.login() 호출
 *    → 성공 시 AuthResponse 반환, 실패 시 에러 메시지 반환
 * 3) 내 정보 조회 (GET /auth/me):
 *    → Authorization 헤더에서 JWT 토큰 추출 → JwtUtil로 userId 파싱
 *    → AuthService.getUserById()로 사용자 조회 → UserResponse 반환
 *
 * [메서드 목록]
 * - signup(SignupRequest): 회원가입 처리. POST /auth/signup
 * - login(LoginRequest): 로그인 처리. POST /auth/login
 * - me(HttpServletRequest): 현재 로그인한 사용자 정보 조회. GET /auth/me
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @RestController
 *   — @Controller + @ResponseBody의 조합.
 *     모든 메서드의 반환값이 JSON으로 직렬화되어 HTTP 응답 바디에 담긴다.
 *
 * @RequestMapping("/auth")
 *   — 이 컨트롤러의 모든 엔드포인트에 "/auth" 경로 접두사를 추가한다.
 *
 * @PostMapping("/signup"), @PostMapping("/login")
 *   — HTTP POST 요청을 처리하는 메서드를 지정한다.
 *
 * @GetMapping("/me")
 *   — HTTP GET 요청을 처리하는 메서드를 지정한다.
 *
 * @RequestBody
 *   — HTTP 요청 바디의 JSON을 자동으로 Java 객체로 역직렬화한다.
 *     Jackson 라이브러리가 JSON ↔ 객체 변환을 수행한다.
 *
 * ResponseEntity<T>
 *   — HTTP 상태 코드, 헤더, 바디를 포함한 응답을 명시적으로 구성한다.
 *     ResponseEntity.ok(): 200 OK
 *     ResponseEntity.badRequest(): 400 Bad Request
 *     ResponseEntity.status(401): 401 Unauthorized
 *
 * ApiResponse<T>
 *   — 프로젝트 공통 응답 래퍼. { success: boolean, data: T, error: String }
 * ───────────────────────────────────────────
 */
@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService authService;
    private final GoogleOAuthService googleOAuthService;
    private final JwtUtil jwtUtil;
    private final PasswordChangeRateLimiter passwordChangeRateLimiter;
    private final String frontendUrl;

    public AuthController(AuthService authService,
                          GoogleOAuthService googleOAuthService,
                          JwtUtil jwtUtil,
                          PasswordChangeRateLimiter passwordChangeRateLimiter,
                          @Value("${app.frontend-url:mora://auth}") String frontendUrl) {
        this.authService = authService;
        this.googleOAuthService = googleOAuthService;
        this.jwtUtil = jwtUtil;
        this.passwordChangeRateLimiter = passwordChangeRateLimiter;
        this.frontendUrl = frontendUrl;
    }

    /**
     * 회원가입 엔드포인트.
     * 이메일 중복 시 400 에러를 반환한다.
     */
    @PostMapping("/signup")
    public ResponseEntity<ApiResponse<AuthResponse>> signup(@RequestBody SignupRequest request) {
        try {
            AuthResponse response = authService.signup(request);
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("Signup failed"));
        }
    }

    /**
     * 로그인 엔드포인트.
     * 이메일/비밀번호 불일치 시 400 에러를 반환한다.
     */
    @PostMapping("/login")
    public ResponseEntity<ApiResponse<AuthResponse>> login(@RequestBody LoginRequest request) {
        try {
            AuthResponse response = authService.login(request);
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("Invalid email or password"));
        }
    }

    @GetMapping("/google/login")
    public ResponseEntity<Void> googleLogin() {
        return redirect(googleOAuthService.authorizationUrl());
    }

    @GetMapping("/google/callback")
    public ResponseEntity<Void> googleCallback(@RequestParam("code") String code) {
        try {
            AuthResponse response = authService.loginWithOAuth(googleOAuthService.profile(code));
            return redirect(oauthSuccessUrl(response));
        } catch (RuntimeException e) {
            return redirect(oauthFailureUrl());
        }
    }

    /**
     * 현재 로그인한 사용자의 정보를 조회하는 엔드포인트.
     * Authorization 헤더에서 JWT 토큰을 추출하여 사용자를 식별한다.
     * 토큰이 없거나 유효하지 않으면 401 에러를 반환한다.
     */
    @GetMapping("/me")
    public ResponseEntity<ApiResponse<UserResponse>> me(HttpServletRequest request) {
        try {
            // Authorization 헤더에서 Bearer 토큰 추출
            String header = request.getHeader("Authorization");
            if (header == null || !header.startsWith("Bearer "))
                return ResponseEntity.status(401).body(ApiResponse.fail("Token required"));

            // JWT에서 userId 추출 → DB에서 사용자 조회
            UUID userId = jwtUtil.getUserId(header.substring(7));
            User user = authService.getUserById(userId);
            UserResponse response = new UserResponse(
                    user.getId(),
                    user.getEmail(),
                    user.getName(),
                    user.getPicture(),
                    user.getProvider(),
                    user.getCreatedAt()
            );
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("Invalid token"));
        }
    }

    // API-04. 닉네임 변경
    @PatchMapping("/me")
    public ResponseEntity<ApiResponse<UserResponse>> changeName(
            HttpServletRequest request, @RequestBody ChangeNameRequest body) {
        try {
            String header = request.getHeader("Authorization");
            if (header == null || !header.startsWith("Bearer "))
                return ResponseEntity.status(401).body(ApiResponse.fail("Token required"));

            UUID userId = jwtUtil.getUserId(header.substring(7));
            User user = authService.changeName(userId, body.getName());
            UserResponse response = new UserResponse(
                    user.getId(),
                    user.getEmail(),
                    user.getName(),
                    user.getPicture(),
                    user.getProvider(),
                    user.getCreatedAt()
            );
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("Name change failed"));
        }
    }

    // API-05. 비밀번호 변경. rate limit이 인증보다 먼저 돈다
    @PatchMapping("/me/password")
    public ResponseEntity<ApiResponse<Void>> changePassword(
            HttpServletRequest request, @RequestBody ChangePasswordRequest body) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer "))
            return ResponseEntity.status(401).body(ApiResponse.fail("Token required"));

        String token = header.substring(7);
        String key = PasswordChangeRateLimiter.resolveKey(request.getRemoteAddr(), token);
        if (!passwordChangeRateLimiter.tryConsume(key)) {
            return ResponseEntity.status(429).body(ApiResponse.fail("Too many requests"));
        }

        try {
            UUID userId = jwtUtil.getUserId(token);
            authService.changePassword(userId, body.getCurrentPassword(), body.getNewPassword());
            return ResponseEntity.ok(ApiResponse.ok(null));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("Password change failed"));
        }
    }

    // 계정과 명함 이미지(GCS)를 모두 삭제하는 엔드포인트
    @DeleteMapping("/me")
    public ResponseEntity<ApiResponse<Void>> deleteMe(HttpServletRequest request) {
        try {
            String header = request.getHeader("Authorization");
            if (header == null || !header.startsWith("Bearer "))
                return ResponseEntity.status(401).body(ApiResponse.fail("Token required"));

            UUID userId = jwtUtil.getUserId(header.substring(7));
            authService.deleteAccount(userId);
            return ResponseEntity.ok(ApiResponse.ok(null));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("Account deletion failed"));
        }
    }

    private ResponseEntity<Void> redirect(String url) {
        HttpHeaders headers = new HttpHeaders();
        headers.setLocation(URI.create(url));
        return new ResponseEntity<>(headers, HttpStatus.FOUND);
    }

    private String oauthSuccessUrl(AuthResponse response) {
        return UriComponentsBuilder.fromUriString(normalizeFrontendUrl())
                .path("/dashboard")
                .queryParam("token", response.getToken())
                .queryParam("userId", response.getUserId())
                .queryParam("email", response.getEmail())
                .queryParam("name", response.getName())
                .queryParam("provider", "google")
                .build()
                .toUriString();
    }

    private String oauthFailureUrl() {
        return UriComponentsBuilder.fromUriString(normalizeFrontendUrl())
                .path("/login")
                .queryParam("oauth_error", "google")
                .build()
                .toUriString();
    }

    private String normalizeFrontendUrl() {
        String value = frontendUrl == null || frontendUrl.isBlank() ? "mora://auth" : frontendUrl.trim();
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }
}
