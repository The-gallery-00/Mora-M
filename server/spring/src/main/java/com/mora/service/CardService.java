package com.mora.service;

import com.mora.dto.CardResponse;
import com.mora.dto.CardSaveRequest;
import com.mora.entity.BusinessCard;
import com.mora.repository.BusinessCardRepository;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;

/**
 * ═══════════════════════════════════════════════════════════════
 * CardService — 명함 CRUD 및 검색 비즈니스 로직 서비스
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 명함의 저장, 목록 조회, 수정, 삭제, 벡터 유사도 검색 등
 * 핵심 비즈니스 로직을 처리하는 서비스 클래스이다.
 * CardController에서 호출되며, BusinessCardRepository를 통해 DB에 접근하고,
 * EmbeddingService를 통해 텍스트 임베딩을 생성한다.
 *
 * [코드 흐름]
 * 1) 저장 (save):
 *    → 명함 필드들을 합쳐 임베딩 텍스트 생성 → OpenAI API로 임베딩 벡터 획득
 *    → BusinessCard 엔티티 생성·저장 → CardResponse 반환
 * 2) 목록 조회 (listByUser):
 *    → 사용자 ID로 명함 목록을 최신순 조회 → CardResponse 리스트 반환
 * 3) 수정 (update):
 *    → 명함 조회 → 소유자 확인 → 필드 업데이트 → 임베딩 재생성 → 저장
 * 4) 삭제 (delete):
 *    → 명함 조회 → 소유자 확인 → DB에서 삭제
 * 5) 검색 (search):
 *    → 검색 쿼리 임베딩 생성 → pgvector 코사인 유사도 검색 → CardResponse 리스트 반환
 *
 * [메서드 목록]
 * - save(UUID userId, CardSaveRequest): 명함을 저장하고 임베딩을 생성한다.
 * - listByUser(UUID userId): 사용자의 명함 목록을 최신순으로 조회한다.
 * - update(UUID userId, UUID cardId, CardSaveRequest): 명함 정보를 수정한다.
 * - delete(UUID userId, UUID cardId): 명함을 삭제한다.
 * - search(UUID userId, String query, int topK): 벡터 유사도 기반 명함 검색.
 * - buildEmbeddingText(...): 명함 필드들을 하나의 텍스트로 합치는 내부 유틸.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Service
 *   — 서비스 계층 빈 선언. Spring이 자동으로 등록한다.
 *
 * BusinessCardRepository
 *   — save(): 명함 엔티티를 DB에 저장(INSERT/UPDATE).
 *   — findById(): UUID로 명함 조회.
 *   — findByUserIdOrderByCreatedAtDesc(): 사용자별 최신순 조회.
 *   — delete(): 엔티티 삭제.
 *   — searchByVector(): pgvector 코사인 유사도 기반 검색.
 *
 * EmbeddingService
 *   — getEmbedding(text): 텍스트를 OpenAI text-embedding-ada-002 모델로
 *     벡터로 변환하여 문자열로 반환한다.
 *
 * CardResponse.from(BusinessCard)
 *   — 엔티티를 응답 DTO로 변환하는 정적 팩토리 메서드.
 *
 * java.sql.Timestamp
 *   — 네이티브 쿼리 결과의 created_at 컬럼을 LocalDateTime으로 변환할 때 사용.
 * ───────────────────────────────────────────
 */
@Service
public class CardService {

    private final BusinessCardRepository cardRepository;
    private final EmbeddingService embeddingService;

    public CardService(BusinessCardRepository cardRepository, EmbeddingService embeddingService) {
        this.cardRepository = cardRepository;
        this.embeddingService = embeddingService;
    }

    /**
     * 명함을 저장한다.
     * 명함 필드를 합쳐 임베딩 텍스트를 만들고, OpenAI API로 벡터를 생성한 뒤 DB에 저장한다.
     */
    public CardResponse save(UUID userId, CardSaveRequest request) {
        // 명함의 주요 필드들을 하나의 문자열로 합쳐 임베딩 입력 텍스트를 만든다
        String textForEmbedding = buildEmbeddingText(
                request.getName(), request.getCompany(), request.getPosition(),
                request.getPhone(), request.getEmail(), request.getRawOcrText()
        );

        // OpenAI API를 통해 임베딩 벡터를 생성한다 (실패 시 null)
        String embedding = embeddingService.getEmbedding(textForEmbedding);

        // BusinessCard 엔티티 생성 및 필드 설정
        BusinessCard card = new BusinessCard();
        card.setUserId(userId);
        card.setName(request.getName());
        card.setCompany(request.getCompany());
        card.setPosition(request.getPosition());
        card.setPhone(request.getPhone());
        card.setEmail(request.getEmail());
        card.setRawOcrText(request.getRawOcrText());
        card.setImageUrl(request.getImageUrl());
        card.setEmbedding(embedding);

        // DB에 저장하고 응답 DTO로 변환하여 반환
        card = cardRepository.save(card);
        return CardResponse.from(card);
    }

    /**
     * 특정 사용자의 명함 목록을 최신순(생성일 내림차순)으로 조회한다.
     */
    public List<CardResponse> listByUser(UUID userId) {
        return cardRepository.findByUserIdOrderByCreatedAtDesc(userId)
                .stream()
                .map(CardResponse::from)  // 각 엔티티를 응답 DTO로 변환
                .toList();
    }

    /**
     * 명함 정보를 수정한다.
     * 소유자가 아닌 경우 RuntimeException을 던진다.
     * 수정 후 임베딩 벡터도 재생성한다.
     */
    public CardResponse update(UUID userId, UUID cardId, CardSaveRequest request) {
        // 명함 조회 (없으면 예외)
        BusinessCard card = cardRepository.findById(cardId)
                .orElseThrow(() -> new RuntimeException("Card not found"));

        // 소유자 확인: 요청 사용자와 명함 소유자가 다르면 거부
        if (!card.getUserId().equals(userId)) {
            throw new RuntimeException("Unauthorized");
        }

        // 필드 업데이트
        card.setName(request.getName());
        card.setCompany(request.getCompany());
        card.setPosition(request.getPosition());
        card.setPhone(request.getPhone());
        card.setEmail(request.getEmail());
        // null이 아닌 경우에만 rawOcrText와 imageUrl을 업데이트 (부분 수정 지원)
        if (request.getRawOcrText() != null) {
            card.setRawOcrText(request.getRawOcrText());
        }
        if (request.getImageUrl() != null) {
            card.setImageUrl(request.getImageUrl());
        }

        // 수정된 필드로 임베딩을 재생성
        String textForEmbedding = buildEmbeddingText(
                card.getName(), card.getCompany(), card.getPosition(),
                card.getPhone(), card.getEmail(), card.getRawOcrText()
        );
        card.setEmbedding(embeddingService.getEmbedding(textForEmbedding));

        card = cardRepository.save(card);
        return CardResponse.from(card);
    }

    /**
     * 명함을 삭제한다.
     * 소유자가 아닌 경우 RuntimeException을 던진다.
     */
    public void delete(UUID userId, UUID cardId) {
        BusinessCard card = cardRepository.findById(cardId)
                .orElseThrow(() -> new RuntimeException("Card not found"));

        // 소유자 확인
        if (!card.getUserId().equals(userId)) {
            throw new RuntimeException("Unauthorized");
        }

        cardRepository.delete(card);
    }

    /**
     * 벡터 유사도 기반으로 명함을 검색한다.
     * 검색 쿼리를 임베딩으로 변환한 뒤 pgvector의 코사인 거리로 유사한 명함을 찾는다.
     *
     * @param userId 검색 대상 사용자 ID
     * @param query  검색 키워드 (예: "삼성전자 개발자")
     * @param topK   반환할 최대 결과 수
     */
    public List<CardResponse> search(UUID userId, String query, int topK) {
        // 검색 쿼리를 임베딩 벡터로 변환
        String queryEmbedding = embeddingService.getEmbedding(query);
        if (queryEmbedding == null) {
            return Collections.emptyList();  // 임베딩 생성 실패 시 빈 리스트 반환
        }

        // pgvector 코사인 유사도 검색 (네이티브 쿼리)
        List<Map<String, Object>> results = cardRepository.searchByVector(userId, queryEmbedding, topK);

        // 네이티브 쿼리 결과(Map)를 CardResponse DTO로 변환
        return results.stream().map(row -> {
            CardResponse cardResponse = new CardResponse();
            cardResponse.setId(UUID.fromString(row.get("id").toString()));
            cardResponse.setName((String) row.get("name"));
            cardResponse.setCompany((String) row.get("company"));
            cardResponse.setPosition((String) row.get("position"));
            cardResponse.setPhone((String) row.get("phone"));
            cardResponse.setEmail((String) row.get("email"));
            cardResponse.setRawOcrText((String) row.get("raw_ocr_text"));
            cardResponse.setImageUrl((String) row.get("image_url"));
            // created_at → LocalDateTime 변환 (Instant 또는 Timestamp 둘 다 대응)
            Object createdAtObj = row.get("created_at");
            if (createdAtObj instanceof Instant) {
                cardResponse.setCreatedAt(((Instant) createdAtObj).atZone(ZoneId.systemDefault()).toLocalDateTime());
            } else if (createdAtObj instanceof java.sql.Timestamp) {
                cardResponse.setCreatedAt(((java.sql.Timestamp) createdAtObj).toLocalDateTime());
            }
            // 유사도 점수 설정 (0~1, 높을수록 유사)
            cardResponse.setSimilarity(row.get("similarity") != null
                    ? ((Number) row.get("similarity")).doubleValue()
                    : null);
            return cardResponse;
        }).toList();
    }

    /**
     * 명함 필드들을 하나의 문자열로 합친다.
     * 임베딩 생성을 위한 입력 텍스트로 사용된다.
     * null인 필드는 건너뛴다.
     */
    private String buildEmbeddingText(String name, String company, String position,
                                       String phone, String email, String rawOcrText) {
        StringBuilder sb = new StringBuilder();
        if (name != null) sb.append(name).append(" ");
        if (company != null) sb.append(company).append(" ");
        if (position != null) sb.append(position).append(" ");
        if (phone != null) sb.append(phone).append(" ");
        if (email != null) sb.append(email).append(" ");
        if (rawOcrText != null) sb.append(rawOcrText);
        return sb.toString().trim();
    }
}
