package com.mora.dto;

import com.mora.entity.BusinessCard;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * ═══════════════════════════════════════════════════════════════
 * CardResponse — 명함 응답 DTO
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 명함 조회, 저장, 수정, 검색 결과를 클라이언트에 반환할 때 사용하는 DTO이다.
 * BusinessCard 엔티티의 내부 구조를 외부에 노출하지 않고,
 * 필요한 필드만 선별하여 전달한다.
 * 검색 결과에는 similarity(유사도 점수)가 추가로 포함된다.
 *
 * [코드 흐름]
 * 1) CardService에서 BusinessCard 엔티티를 조회/저장한 뒤
 *    CardResponse.from(card)을 호출하여 DTO로 변환한다.
 * 2) 벡터 검색 시에는 네이티브 쿼리 결과(Map)에서 직접 CardResponse를 생성하고
 *    similarity 필드를 추가로 설정한다.
 * 3) CardController에서 ApiResponse.ok(cardResponse)로 감싸 반환한다.
 *
 * [메서드 목록]
 * - from(BusinessCard card): BusinessCard 엔티티를 CardResponse DTO로 변환하는 정적 팩토리 메서드.
 * - getter/setter: 모든 필드에 대한 접근자/설정자.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * (별도 어노테이션 없음 — 순수 POJO DTO)
 * Jackson이 getter 메서드를 기반으로 JSON 직렬화를 수행한다.
 * ───────────────────────────────────────────
 */
public class CardResponse {

    /** 명함 고유 ID (UUID) */
    private UUID id;
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
    /** OCR로 인식된 원본 텍스트 전체 */
    private String rawOcrText;
    /** 명함 이미지 URL */
    private String imageUrl;
    /** 명함 등록 일시 */
    private LocalDateTime createdAt;
    /** 벡터 검색 시 코사인 유사도 점수 (0~1, 일반 조회 시 null) */
    private Double similarity;

    public CardResponse() {
    }

    public CardResponse(UUID id, String name, String company, String position, String phone,
                        String email, String rawOcrText, String imageUrl, LocalDateTime createdAt, Double similarity) {
        this.id = id;
        this.name = name;
        this.company = company;
        this.position = position;
        this.phone = phone;
        this.email = email;
        this.rawOcrText = rawOcrText;
        this.imageUrl = imageUrl;
        this.createdAt = createdAt;
        this.similarity = similarity;
    }

    /**
     * BusinessCard 엔티티를 CardResponse DTO로 변환하는 정적 팩토리 메서드.
     * similarity는 설정하지 않는다 (벡터 검색이 아닌 일반 조회용).
     */
    public static CardResponse from(BusinessCard card) {
        CardResponse response = new CardResponse();
        response.setId(card.getId());
        response.setName(card.getName());
        response.setCompany(card.getCompany());
        response.setPosition(card.getPosition());
        response.setPhone(card.getPhone());
        response.setEmail(card.getEmail());
        response.setRawOcrText(card.getRawOcrText());
        response.setImageUrl(card.getImageUrl());
        response.setCreatedAt(card.getCreatedAt());
        return response;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
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

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public Double getSimilarity() {
        return similarity;
    }

    public void setSimilarity(Double similarity) {
        this.similarity = similarity;
    }
}
