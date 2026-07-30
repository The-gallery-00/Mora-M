package com.mora.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/**
 * ═══════════════════════════════════════════════════════════════
 * EmbeddingService — OpenAI 임베딩 벡터 생성 서비스
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 텍스트를 OpenAI의 text-embedding-ada-002 모델을 이용하여
 * 임베딩 벡터(숫자 배열)로 변환하는 서비스이다.
 * CardService에서 명함 저장/수정/검색 시 텍스트를 벡터로 변환할 때 사용된다.
 * 생성된 벡터는 문자열 형태("[0.1, 0.2, ...]")로 반환되어
 * BusinessCard.embedding 필드에 저장되고, pgvector로 유사도 검색에 활용된다.
 *
 * [코드 흐름]
 * 1) CardService에서 getEmbedding(text)을 호출한다.
 * 2) OpenAI API 키가 설정되어 있는지 확인한다 (없으면 null 반환).
 * 3) RestTemplate을 사용하여 OpenAI Embeddings API에 POST 요청을 보낸다.
 *    - Authorization: Bearer {API_KEY}
 *    - Body: { "input": "텍스트", "model": "text-embedding-ada-002" }
 * 4) 응답에서 data[0].embedding 배열을 추출한다.
 * 5) List<Double>을 toString()으로 문자열 변환하여 반환한다.
 * 6) 오류 발생 시 로그를 남기고 null을 반환한다.
 *
 * [메서드 목록]
 * - getEmbedding(String text): 텍스트를 임베딩 벡터 문자열로 변환한다.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Service
 *   — 서비스 계층 빈 선언.
 *
 * @Value("${app.openai-api-key}")
 *   — application.yml에서 OpenAI API 키를 주입한다.
 *
 * @SuppressWarnings("unchecked")
 *   — 제네릭 타입 캐스팅 경고를 억제한다 (Map 응답 파싱 시 불가피).
 *
 * [RestTemplate (Spring Web)]
 * ───────────────────────────────────────────
 * restTemplate.exchange(url, method, request, responseType)
 *   — HTTP 요청을 보내고 ResponseEntity로 응답을 받는다.
 *     POST 메서드로 OpenAI API를 호출한다.
 *
 * [HttpHeaders / HttpEntity (Spring Web)]
 * ───────────────────────────────────────────
 * HttpHeaders.setContentType(MediaType.APPLICATION_JSON)
 *   — 요청 Content-Type을 application/json으로 설정한다.
 *
 * HttpHeaders.setBearerAuth(token)
 *   — Authorization 헤더에 "Bearer {token}" 값을 설정한다.
 *
 * HttpEntity<T>
 *   — HTTP 요청의 헤더와 바디를 담는 래퍼 객체.
 *
 * [SLF4J Logger]
 * ───────────────────────────────────────────
 * LoggerFactory.getLogger(Class)
 *   — 클래스별 Logger 인스턴스를 생성한다.
 *
 * log.warn() / log.error()
 *   — 경고/에러 레벨 로그를 출력한다.
 * ───────────────────────────────────────────
 */
@Service
public class EmbeddingService {

    private static final Logger log = LoggerFactory.getLogger(EmbeddingService.class);

    private final RestTemplate restTemplate;

    @Value("${app.openai-api-key}")
    private String openaiApiKey;

    /** OpenAI Embeddings API 엔드포인트 */
    private static final String OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";

    public EmbeddingService(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    /**
     * 텍스트를 OpenAI text-embedding-ada-002 모델로 임베딩 벡터 문자열로 변환한다.
     * API 키가 미설정이거나 호출 실패 시 null을 반환한다.
     *
     * @param text 임베딩할 입력 텍스트 (명함 정보 등)
     * @return 임베딩 벡터 문자열 (예: "[0.0023, -0.0091, ...]") 또는 null
     */
    @SuppressWarnings("unchecked")
    public String getEmbedding(String text) {
        // API 키가 설정되지 않았으면 임베딩을 건너뛴다
        if (openaiApiKey == null || openaiApiKey.isBlank()) {
            log.warn("OpenAI API key not configured, skipping embedding generation");
            return null;
        }

        try {
            // HTTP 요청 헤더 설정
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);  // Content-Type: application/json
            headers.setBearerAuth(openaiApiKey);                 // Authorization: Bearer {API_KEY}

            // 요청 바디: 임베딩할 텍스트와 모델명
            Map<String, Object> body = Map.of(
                    "input", text,
                    "model", "text-embedding-ada-002"
            );

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

            // OpenAI API에 POST 요청을 보내고 응답을 Map으로 받는다
            ResponseEntity<Map> response = restTemplate.exchange(
                    OPENAI_EMBEDDING_URL,
                    HttpMethod.POST,
                    request,
                    Map.class
            );

            Map<String, Object> responseBody = response.getBody();
            if (responseBody == null) return null;

            // 응답 구조: { "data": [ { "embedding": [0.0023, -0.0091, ...] } ] }
            List<Map<String, Object>> data = (List<Map<String, Object>>) responseBody.get("data");
            if (data == null || data.isEmpty()) return null;

            // 첫 번째 결과의 embedding 배열을 추출
            List<Double> embedding = (List<Double>) data.get(0).get("embedding");
            // List<Double>.toString()은 "[0.0023, -0.0091, ...]" 형태 → pgvector CAST에 사용
            return embedding.toString();
        } catch (Exception e) {
            log.error("Failed to generate embedding: {}", e.getMessage());
            return null;
        }
    }
}
