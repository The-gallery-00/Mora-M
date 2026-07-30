package com.mora.dto;

/**
 * ═══════════════════════════════════════════════════════════════
 * CardSaveRequest — 명함 저장/수정 요청 DTO
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 클라이언트가 명함을 저장(POST /api/save) 또는 수정(PUT /api/cards/{id})
 * 할 때 전송하는 JSON 요청 바디를 매핑하는 DTO 클래스이다.
 * OCR로 인식된 명함 정보(이름, 회사, 직책, 전화번호, 이메일)와
 * 원본 OCR 텍스트, 이미지 URL을 포함한다.
 *
 * [코드 흐름]
 * 1) 클라이언트가 JSON 요청 바디를 전송한다.
 * 2) @RequestBody에 의해 Jackson이 JSON → CardSaveRequest 객체로 역직렬화한다.
 * 3) CardController에서 CardService.save() 또는 update()에 이 객체를 전달한다.
 * 4) CardService에서 각 getter로 필드를 읽어 BusinessCard 엔티티에 설정한다.
 *
 * 요청 JSON 예시:
 * {
 *   "name": "홍길동",
 *   "company": "삼성전자",
 *   "position": "수석 엔지니어",
 *   "phone": "010-1234-5678",
 *   "email": "hong@samsung.com",
 *   "rawOcrText": "홍길동 삼성전자 수석 엔지니어 ...",
 *   "imageUrl": "https://storage.example.com/card.jpg"
 * }
 *
 * [메서드 목록]
 * - 생성자: 모든 필드를 받는 생성자 및 기본 생성자.
 * - getter/setter: 모든 필드에 대한 접근자/설정자.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * (별도 어노테이션 없음 — 순수 POJO DTO)
 * Jackson이 setter 메서드와 필드명을 기반으로 JSON 역직렬화를 수행한다.
 * ───────────────────────────────────────────
 */
public class CardSaveRequest {

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

    public CardSaveRequest() {
    }

    public CardSaveRequest(String name, String company, String position, String phone,
                           String email, String rawOcrText, String imageUrl) {
        this.name = name;
        this.company = company;
        this.position = position;
        this.phone = phone;
        this.email = email;
        this.rawOcrText = rawOcrText;
        this.imageUrl = imageUrl;
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
}
