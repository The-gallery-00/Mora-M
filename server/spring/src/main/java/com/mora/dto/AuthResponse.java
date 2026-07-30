package com.mora.dto;

import java.util.UUID;

/**
 * ═══════════════════════════════════════════════════════════════
 * AuthResponse — 인증 응답 DTO (회원가입/로그인 결과)
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 회원가입 또는 로그인 성공 시 클라이언트에 반환되는 응답 DTO이다.
 * JWT 토큰, 사용자 ID, 이메일, 이름을 포함한다.
 * 클라이언트는 이 응답의 token을 저장하여 이후 요청의
 * Authorization 헤더에 포함시킨다.
 *
 * [코드 흐름]
 * 1) AuthService.signup() 또는 login()에서 이 객체를 생성한다.
 * 2) AuthController에서 ApiResponse.ok(authResponse)로 감싸 반환한다.
 * 3) Jackson이 JSON으로 직렬화하여 클라이언트에 전송한다.
 *
 * JSON 예시:
 * {
 *   "token": "eyJhbGciOi...",
 *   "userId": "550e8400-...",
 *   "email": "user@example.com",
 *   "name": "홍길동"
 * }
 *
 * [메서드 목록]
 * - 생성자: 모든 필드를 받는 생성자 및 기본 생성자.
 * - getter/setter: token, userId, email, name 필드에 대한 접근자/설정자.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * (별도 어노테이션 없음 — 순수 POJO DTO)
 * Jackson이 getter 메서드를 기반으로 JSON 직렬화를 수행한다.
 * ───────────────────────────────────────────
 */
public class AuthResponse {

    /** JWT 인증 토큰 — 클라이언트가 이후 요청에 "Bearer {token}" 형태로 전송 */
    private String token;
    /** 사용자 고유 ID (UUID) */
    private UUID userId;
    /** 사용자 이메일 */
    private String email;
    /** 사용자 이름 */
    private String name;

    public AuthResponse() {
    }

    public AuthResponse(String token, UUID userId, String email, String name) {
        this.token = token;
        this.userId = userId;
        this.email = email;
        this.name = name;
    }

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public UUID getUserId() {
        return userId;
    }

    public void setUserId(UUID userId) {
        this.userId = userId;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
