package com.mora.dto;

/**
 * ═══════════════════════════════════════════════════════════════
 * SignupRequest — 회원가입 요청 DTO
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 클라이언트가 회원가입(POST /auth/signup) 시 전송하는
 * JSON 요청 바디를 매핑하는 DTO 클래스이다.
 * 이메일, 비밀번호, 이름을 포함한다.
 *
 * [코드 흐름]
 * 1) 클라이언트가 { "email": "...", "password": "...", "name": "..." } JSON을 전송한다.
 * 2) @RequestBody에 의해 Jackson이 JSON → SignupRequest 객체로 역직렬화한다.
 * 3) AuthController.signup()에서 AuthService.signup()에 이 객체를 전달한다.
 * 4) AuthService에서 getEmail()로 중복 확인, getPassword()를 BCrypt 해싱하여 저장,
 *    getName()으로 사용자 이름을 설정한다.
 *
 * 요청 JSON 예시:
 * {
 *   "email": "user@example.com",
 *   "password": "mypassword123",
 *   "name": "홍길동"
 * }
 *
 * [메서드 목록]
 * - 생성자: 모든 필드를 받는 생성자 및 기본 생성자.
 * - getter/setter: email, password, name 필드에 대한 접근자/설정자.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * (별도 어노테이션 없음 — 순수 POJO DTO)
 * Jackson이 JSON 역직렬화를 수행한다.
 * ───────────────────────────────────────────
 */
public class SignupRequest {

    /** 가입 이메일 */
    private String email;
    /** 가입 비밀번호 (평문, BCrypt 해싱 전) */
    private String password;
    /** 사용자 이름 */
    private String name;

    public SignupRequest() {
    }

    public SignupRequest(String email, String password, String name) {
        this.email = email;
        this.password = password;
        this.name = name;
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

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
