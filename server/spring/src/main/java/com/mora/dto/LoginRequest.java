package com.mora.dto;

/**
 * ═══════════════════════════════════════════════════════════════
 * LoginRequest — 로그인 요청 DTO
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 클라이언트가 로그인(POST /auth/login) 시 전송하는
 * JSON 요청 바디를 매핑하는 DTO 클래스이다.
 * 이메일과 비밀번호를 포함한다.
 *
 * [코드 흐름]
 * 1) 클라이언트가 { "email": "...", "password": "..." } JSON을 전송한다.
 * 2) @RequestBody에 의해 Jackson이 JSON → LoginRequest 객체로 역직렬화한다.
 * 3) AuthController.login()에서 AuthService.login()에 이 객체를 전달한다.
 * 4) AuthService에서 getEmail()로 사용자를 조회하고,
 *    getPassword()로 BCrypt 비밀번호를 검증한다.
 *
 * 요청 JSON 예시:
 * {
 *   "email": "user@example.com",
 *   "password": "mypassword123"
 * }
 *
 * [메서드 목록]
 * - 생성자: 모든 필드를 받는 생성자 및 기본 생성자.
 * - getter/setter: email, password 필드에 대한 접근자/설정자.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * (별도 어노테이션 없음 — 순수 POJO DTO)
 * Jackson이 JSON 역직렬화를 수행한다.
 * ───────────────────────────────────────────
 */
public class LoginRequest {

    /** 로그인 이메일 */
    private String email;
    /** 로그인 비밀번호 (평문, BCrypt 해싱 전) */
    private String password;

    public LoginRequest() {
    }

    public LoginRequest(String email, String password) {
        this.email = email;
        this.password = password;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }
}
