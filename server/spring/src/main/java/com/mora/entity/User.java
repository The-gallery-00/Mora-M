package com.mora.entity;

import jakarta.persistence.*;

import java.time.LocalDateTime;
import java.util.Objects;
import java.util.UUID;

/**
 * ═══════════════════════════════════════════════════════════════
 * User — 사용자 엔티티 (users 테이블 매핑)
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 데이터베이스의 users 테이블과 매핑되는 JPA 엔티티 클래스이다.
 * 사용자의 ID, 인증 제공자(local/OAuth), 이메일, 비밀번호 해시,
 * 이름, 프로필 사진 URL, 가입일시 등을 관리한다.
 * AuthService에서 회원가입/로그인 시 이 엔티티를 생성·조회하고,
 * UserRepository를 통해 DB에 영속화한다.
 *
 * [코드 흐름]
 * 1) AuthService.signup()에서 User 객체를 생성하고 필드를 설정한다.
 * 2) UserRepository.save(user)가 호출되면 JPA가 INSERT SQL을 실행한다.
 * 3) @PrePersist에 의해 createdAt이 자동으로 현재 시각으로 설정된다.
 * 4) AuthService.login()에서 UserRepository.findByEmail()로 사용자를 조회한다.
 * 5) AuthController.me()에서 getUserById()로 현재 로그인 사용자 정보를 조회한다.
 *
 * [메서드 목록]
 * - onCreate(): @PrePersist 콜백. 엔티티가 DB에 저장되기 전 createdAt을 설정한다.
 * - getter/setter: 각 필드에 대한 접근자/설정자.
 * - equals(Object): id 기반 동등성 비교.
 * - hashCode(): id 기반 해시 코드 생성.
 * - toString(): 사용자 정보 요약 문자열 반환.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Entity
 *   — 이 클래스가 JPA 엔티티임을 선언한다. DB 테이블과 매핑된다.
 *
 * @Table(name = "users")
 *   — 매핑할 테이블 이름을 "users"로 지정한다.
 *     (기본값은 클래스 이름이지만, "user"는 SQL 예약어이므로 "users" 사용)
 *
 * @Id
 *   — 이 필드가 엔티티의 기본 키(Primary Key)임을 표시한다.
 *
 * @GeneratedValue(strategy = GenerationType.UUID)
 *   — JPA가 UUID를 자동으로 생성하여 기본 키 값으로 설정한다.
 *
 * @Column(unique = true, nullable = false)
 *   — email 컬럼에 유니크 제약 조건과 NOT NULL 제약 조건을 설정한다.
 *
 * @Column(updatable = false)
 *   — createdAt 컬럼은 UPDATE 시 변경되지 않도록 한다.
 *
 * @PrePersist
 *   — 엔티티가 처음 영속화(INSERT)되기 직전에 호출되는 콜백 메서드를 지정한다.
 * ───────────────────────────────────────────
 */
@Entity
@Table(name = "users")
public class User {

    /** 사용자 고유 ID (UUID, 기본 키) */
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** 인증 제공자 ("local" = 이메일/비밀번호 직접 가입, 그 외 OAuth 제공자명) */
    private String provider;

    /** 사용자 이메일 (유니크, NOT NULL) — 로그인 시 식별자로 사용 */
    @Column(unique = true, nullable = false)
    private String email;

    /** 비밀번호 해시 (BCrypt로 인코딩된 값) */
    private String passwordHash;

    /** 사용자 이름 */
    private String name;

    /** 프로필 사진 URL */
    private String picture;

    /** 계정 생성 일시 (INSERT 시 자동 설정, UPDATE 시 변경 불가) */
    @Column(updatable = false)
    private LocalDateTime createdAt;

    public User() {
    }

    public User(UUID id, String provider, String email, String passwordHash, String name, String picture, LocalDateTime createdAt) {
        this.id = id;
        this.provider = provider;
        this.email = email;
        this.passwordHash = passwordHash;
        this.name = name;
        this.picture = picture;
        this.createdAt = createdAt;
    }

    /**
     * 엔티티가 처음 DB에 저장되기 직전 호출되어 createdAt을 현재 시각으로 설정한다.
     */
    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getProvider() {
        return provider;
    }

    public void setProvider(String provider) {
        this.provider = provider;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
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

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        User user = (User) o;
        return Objects.equals(id, user.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }

    @Override
    public String toString() {
        return "User{" +
                "id=" + id +
                ", provider='" + provider + '\'' +
                ", email='" + email + '\'' +
                ", name='" + name + '\'' +
                '}';
    }
}
