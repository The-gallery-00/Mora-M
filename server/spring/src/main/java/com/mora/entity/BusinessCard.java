package com.mora.entity;

import jakarta.persistence.*;

import java.time.LocalDateTime;
import java.util.Objects;
import java.util.UUID;

/**
 * ═══════════════════════════════════════════════════════════════
 * BusinessCard — 명함 엔티티 (business_cards 테이블 매핑)
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 데이터베이스의 business_cards 테이블과 매핑되는 JPA 엔티티이다.
 * OCR로 인식된 명함 데이터를 저장하며, 이름, 회사, 직책, 전화번호,
 * 이메일, 원본 OCR 텍스트, 명함 이미지 URL, 임베딩 벡터 등을 관리한다.
 * CardService에서 명함 CRUD 작업 시 이 엔티티를 사용하고,
 * BusinessCardRepository를 통해 DB에 영속화한다.
 *
 * [코드 흐름]
 * 1) CardService.save()에서 BusinessCard 객체를 생성하고 필드를 설정한다.
 * 2) EmbeddingService에서 생성한 임베딩 벡터 문자열을 embedding 필드에 저장한다.
 * 3) BusinessCardRepository.save()가 호출되면 JPA가 INSERT SQL을 실행한다.
 * 4) @PrePersist에 의해 createdAt이 자동으로 현재 시각으로 설정된다.
 * 5) 조회 시 findByUserIdOrderByCreatedAtDesc()로 사용자별 명함 목록을 가져온다.
 * 6) 벡터 검색 시 searchByVector()로 유사도 기반 명함 검색을 수행한다.
 *
 * [메서드 목록]
 * - onCreate(): @PrePersist 콜백. 엔티티 저장 전 createdAt을 설정한다.
 * - getter/setter: 각 필드에 대한 접근자/설정자.
 * - equals(Object): id 기반 동등성 비교.
 * - hashCode(): id 기반 해시 코드 생성.
 * - toString(): 명함 정보 요약 문자열 반환.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Entity
 *   — JPA 엔티티 선언. DB 테이블과 매핑된다.
 *
 * @Table(name = "business_cards")
 *   — 매핑할 테이블 이름을 "business_cards"로 지정한다.
 *
 * @Id
 *   — 기본 키(Primary Key) 필드를 표시한다.
 *
 * @GeneratedValue(strategy = GenerationType.UUID)
 *   — JPA가 UUID를 자동 생성하여 기본 키로 설정한다.
 *
 * @Column(nullable = false)
 *   — userId 컬럼에 NOT NULL 제약 조건을 설정한다.
 *
 * @Column(columnDefinition = "TEXT")
 *   — rawOcrText, embedding 컬럼의 DB 타입을 TEXT로 지정한다.
 *     긴 문자열(OCR 원문, 임베딩 벡터 배열)을 저장하기 위해 사용한다.
 *
 * @Column(updatable = false)
 *   — createdAt 컬럼이 UPDATE 시 변경되지 않도록 한다.
 *
 * @PrePersist
 *   — 엔티티가 처음 영속화(INSERT)되기 직전에 호출되는 콜백.
 * ───────────────────────────────────────────
 */
@Entity
@Table(name = "business_cards")
public class BusinessCard {

    /** 명함 고유 ID (UUID, 기본 키) */
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** 이 명함을 등록한 사용자의 ID (FK 역할, NOT NULL) */
    @Column(nullable = false)
    private UUID userId;

    /** 명함에 기재된 이름 */
    private String name;

    /** 명함에 기재된 회사명 */
    private String company;

    /** 명함에 기재된 직책/직위 */
    private String position;

    /** 명함에 기재된 전화번호 */
    private String phone;

    /** 명함에 기재된 이메일 */
    private String email;

    /** OCR로 인식된 원본 텍스트 전체 (TEXT 타입) */
    @Column(columnDefinition = "TEXT")
    private String rawOcrText;

    /** 명함 이미지 URL (S3 등 외부 저장소 경로) */
    private String imageUrl;

    /** 임베딩 벡터 (pgvector vector(1536) 타입) */
    @Column(columnDefinition = "vector(1536)")
    private String embedding;

    /** 명함 등록 일시 (INSERT 시 자동 설정, UPDATE 시 변경 불가) */
    @Column(updatable = false)
    private LocalDateTime createdAt;

    public BusinessCard() {
    }

    public BusinessCard(UUID id, UUID userId, String name, String company, String position, String phone,
                        String email, String rawOcrText, String imageUrl, String embedding, LocalDateTime createdAt) {
        this.id = id;
        this.userId = userId;
        this.name = name;
        this.company = company;
        this.position = position;
        this.phone = phone;
        this.email = email;
        this.rawOcrText = rawOcrText;
        this.imageUrl = imageUrl;
        this.embedding = embedding;
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

    public UUID getUserId() {
        return userId;
    }

    public void setUserId(UUID userId) {
        this.userId = userId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getCompany() {
        return company;
    }

    public void setCompany(String company) {
        this.company = company;
    }

    public String getPosition() {
        return position;
    }

    public void setPosition(String position) {
        this.position = position;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getRawOcrText() {
        return rawOcrText;
    }

    public void setRawOcrText(String rawOcrText) {
        this.rawOcrText = rawOcrText;
    }

    public String getImageUrl() {
        return imageUrl;
    }

    public void setImageUrl(String imageUrl) {
        this.imageUrl = imageUrl;
    }

    public String getEmbedding() {
        return embedding;
    }

    public void setEmbedding(String embedding) {
        this.embedding = embedding;
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
        BusinessCard that = (BusinessCard) o;
        return Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }

    @Override
    public String toString() {
        return "BusinessCard{" +
                "id=" + id +
                ", userId=" + userId +
                ", name='" + name + '\'' +
                ", company='" + company + '\'' +
                '}';
    }
}
