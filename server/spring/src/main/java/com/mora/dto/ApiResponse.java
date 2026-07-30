package com.mora.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * ═══════════════════════════════════════════════════════════════
 * ApiResponse<T> — 공통 API 응답 래퍼 DTO
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 모든 REST API 응답을 통일된 형식으로 감싸는 제네릭 래퍼 클래스이다.
 * 성공/실패 여부(success), 실제 데이터(data), 에러 메시지(error)를
 * 하나의 JSON 구조로 반환한다.
 *
 * 응답 JSON 예시 (성공): { "success": true, "data": { ... } }
 * 응답 JSON 예시 (실패): { "success": false, "error": "에러 메시지" }
 *
 * [코드 흐름]
 * 1) 컨트롤러에서 ApiResponse.ok(data)를 호출하면 success=true, data=T 인 응답 생성.
 * 2) 컨트롤러에서 ApiResponse.fail(error)를 호출하면 success=false, error=메시지 인 응답 생성.
 * 3) Jackson이 이 객체를 JSON으로 직렬화할 때, @JsonInclude에 의해 null 필드는 제외된다.
 *    → 성공 응답에서는 error 필드가 생략되고, 실패 응답에서는 data 필드가 생략된다.
 *
 * [메서드 목록]
 * - ok(T data): 성공 응답을 생성하는 정적 팩토리 메서드.
 * - fail(String error): 실패 응답을 생성하는 정적 팩토리 메서드.
 * - getter/setter: success, data, error 필드에 대한 접근자/설정자.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @JsonInclude(JsonInclude.Include.NON_NULL)
 *   — Jackson 직렬화 시 null인 필드를 JSON에 포함하지 않는다.
 *     성공 시 error=null → JSON에서 "error" 키 자체가 생략됨.
 *     실패 시 data=null → JSON에서 "data" 키 자체가 생략됨.
 *
 * Jackson (com.fasterxml.jackson)
 *   — Spring Boot의 기본 JSON 직렬화/역직렬화 라이브러리.
 *     @RestController의 반환값을 자동으로 JSON으로 변환한다.
 * ───────────────────────────────────────────
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {

    /** 요청 성공 여부 */
    private boolean success;
    /** 성공 시 실제 응답 데이터 (실패 시 null) */
    private T data;
    /** 실패 시 에러 메시지 (성공 시 null) */
    private String error;

    public ApiResponse() {
    }

    public ApiResponse(boolean success, T data, String error) {
        this.success = success;
        this.data = data;
        this.error = error;
    }

    /**
     * 성공 응답을 생성하는 정적 팩토리 메서드.
     * success=true, data=주어진 데이터, error=null
     */
    public static <T> ApiResponse<T> ok(T data) {
        ApiResponse<T> response = new ApiResponse<>();
        response.setSuccess(true);
        response.setData(data);
        return response;
    }

    /**
     * 실패 응답을 생성하는 정적 팩토리 메서드.
     * success=false, data=null, error=주어진 에러 메시지
     */
    public static <T> ApiResponse<T> fail(String error) {
        ApiResponse<T> response = new ApiResponse<>();
        response.setSuccess(false);
        response.setError(error);
        return response;
    }

    public boolean isSuccess() {
        return success;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public T getData() {
        return data;
    }

    public void setData(T data) {
        this.data = data;
    }

    public String getError() {
        return error;
    }

    public void setError(String error) {
        this.error = error;
    }
}
