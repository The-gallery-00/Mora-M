package com.mora.dto;

import java.util.UUID;

/**
 * ═══════════════════════════════════════════════════════════════
 * UserResponse — 사용자 정보 응답 DTO
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 현재 로그인한 사용자의 정보를 클라이언트에 반환할 때 사용하는 DTO이다.
 * GET /auth/me 엔드포인트의 응답으로 사용된다.
 * User 엔티티의 민감 정보(비밀번호 해시 등)를 제외하고
 * 필요한 필드만 선별하여 전달한다.
 *
 * [코드 흐름]
 * 1) AuthController.me()에서 JWT 토큰으로 사용자를 조회한다.
 * 2) User 엔티티에서 필요한 필드를 꺼내 UserResponse를 생성한다.
 * 3) ApiResponse.ok(userResponse)로 감싸 반환한다.
 *
 * JSON 예시:
 * {
 *   "id": "550e8400-...",
 *   "email": "user@example.com",
 *   "name": "홍길동",
 *   "picture": "https://example.com/photo.jpg"
 * }
 *
 * [메서드 목록]
 * - 생성자: 모든 필드를 받는 생성자 및 기본 생성자.
 * - getter/setter: id, email, name, picture 필드에 대한 접근자/설정자.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * (별도 어노테이션 없음 — 순수 POJO DTO)
 * Jackson이 getter 메서드를 기반으로 JSON 직렬화를 수행한다.
 * ───────────────────────────────────────────
 */
public class UserResponse {

    /** 사용자 고유 ID (UUID) */
    private UUID id;
    /** 사용자 이메일 */
    private String email;
    /** 사용자 이름 */
    private String name;
    /** 프로필 사진 URL (없으면 null) */
    private String picture;

    public UserResponse() {
    }

    public UserResponse(UUID id, String email, String name, String picture) {
        this.id = id;
        this.email = email;
        this.name = name;
        this.picture = picture;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
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

    public String getPicture() {
        return picture;
    }

    public void setPicture(String picture) {
        this.picture = picture;
    }
}
