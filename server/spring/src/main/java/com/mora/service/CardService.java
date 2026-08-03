package com.mora.service;

import com.mora.dto.CardResponse;
import com.mora.dto.CardSaveRequest;
import com.mora.entity.BusinessCard;
import com.mora.repository.CardGroupRepository;
import com.mora.repository.BusinessCardRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.ZoneId;
import java.util.*;

@Service
public class CardService {

    private static final double FUZZY_THRESHOLD_START = 1.0;
    private static final double FUZZY_THRESHOLD_STEP = 0.1;
    private static final int FUZZY_MAX_ITERATIONS = 8;
    private static final double FUZZY_WEIGHT = 0.6;
    private static final double VECTOR_WEIGHT = 0.4;
    private static final double VECTOR_MIN_SCORE = 0.3;
    private static final double MIN_COMBINED_SCORE = 0.4;

    private final BusinessCardRepository cardRepository;
    private final CardGroupRepository groupRepository;
    private final EmbeddingService embeddingService;
    private final OcrService ocrService;

    public CardService(BusinessCardRepository cardRepository, CardGroupRepository groupRepository,
                       EmbeddingService embeddingService, OcrService ocrService) {
        this.cardRepository = cardRepository;
        this.groupRepository = groupRepository;
        this.embeddingService = embeddingService;
        this.ocrService = ocrService;
    }

    public CardResponse save(UUID userId, CardSaveRequest request) {
        String textForEmbedding = buildEmbeddingText(
                request.getName(), request.getCompany(), request.getPosition(),
                request.getPhone(), request.getEmail(), request.getRawOcrText()
        );
        String embedding = embeddingService.getEmbedding(textForEmbedding);

        BusinessCard card = new BusinessCard();
        card.setUserId(userId);
        card.setName(request.getName());
        card.setCompany(request.getCompany());
        card.setPosition(request.getPosition());
        card.setPhone(request.getPhone());
        card.setEmail(request.getEmail());
        card.setRawOcrText(request.getRawOcrText());
        card.setImageUrl(request.getImageUrl());
        setGroupIfOwned(card, userId, request.getGroupId());
        card.setEmbedding(embedding);

        card = cardRepository.save(card);
        return CardResponse.from(card);
    }

    public CardResponse findById(UUID userId, UUID cardId) {
        BusinessCard card = cardRepository.findByIdAndUserId(cardId, userId)
                .orElseThrow(() -> new RuntimeException("Card not found or unauthorized"));
        return CardResponse.from(card);
    }

    // page/size 페이지네이션, groupId로 그룹 필터, ungrouped=true면 미분류 명함만
    public Page<CardResponse> listByUser(UUID userId, int page, int size, UUID groupId, boolean ungrouped) {
        PageRequest pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        if (ungrouped) {
            return cardRepository.findByUserIdAndGroupIdIsNullOrderByCreatedAtDesc(userId, pageable)
                    .map(CardResponse::from);
        }
        if (groupId != null) {
            return cardRepository.findByUserIdAndGroupIdOrderByCreatedAtDesc(userId, groupId, pageable)
                    .map(CardResponse::from);
        }
        return cardRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable).map(CardResponse::from);
    }

    public CardResponse update(UUID userId, UUID cardId, CardSaveRequest request) {
        BusinessCard card = cardRepository.findById(cardId)
                .orElseThrow(() -> new RuntimeException("Card not found"));

        if (!card.getUserId().equals(userId)) {
            throw new RuntimeException("Unauthorized");
        }

        card.setName(request.getName());
        card.setCompany(request.getCompany());
        card.setPosition(request.getPosition());
        card.setPhone(request.getPhone());
        card.setEmail(request.getEmail());
        if (request.getRawOcrText() != null) {
            card.setRawOcrText(request.getRawOcrText());
        }
        if (request.getImageUrl() != null) {
            card.setImageUrl(request.getImageUrl());
        }
        if (request.getGroupId() != null) {
            setGroupIfOwned(card, userId, request.getGroupId());
        }

        String textForEmbedding = buildEmbeddingText(
                card.getName(), card.getCompany(), card.getPosition(),
                card.getPhone(), card.getEmail(), card.getRawOcrText()
        );
        card.setEmbedding(embeddingService.getEmbedding(textForEmbedding));

        card = cardRepository.save(card);
        return CardResponse.from(card);
    }

    public void delete(UUID userId, UUID cardId) {
        BusinessCard card = cardRepository.findById(cardId)
                .orElseThrow(() -> new RuntimeException("Card not found"));

        if (!card.getUserId().equals(userId)) {
            throw new RuntimeException("Unauthorized");
        }

        deleteImageIfUploaded(card.getImageUrl());
        cardRepository.delete(card);
    }

    public CardResponse moveGroup(UUID userId, UUID cardId, UUID groupId) {
        BusinessCard card = cardRepository.findById(cardId)
                .orElseThrow(() -> new RuntimeException("Card not found"));

        if (!card.getUserId().equals(userId)) {
            throw new RuntimeException("Unauthorized");
        }

        setGroupIfOwned(card, userId, groupId);
        return CardResponse.from(cardRepository.save(card));
    }

    // 하이브리드 검색: fuzzy(pg_trgm)*0.6 + vector(pgvector)*0.4, 결합점수 0.4 미만 제외
    public List<CardResponse> hybridSearch(UUID userId, String query, int topK) {
        double threshold = FUZZY_THRESHOLD_START;
        List<Map<String, Object>> fuzzyResults = Collections.emptyList();

        // 결과가 topK를 채울 때까지 임계값을 단계적으로 낮춤, 최대 반복 횟수로 상한
        for (int i = 0; i < FUZZY_MAX_ITERATIONS && fuzzyResults.size() < topK; i++) {
            fuzzyResults = cardRepository.fuzzySearch(userId, query, threshold, topK);
            if (fuzzyResults.size() >= topK) break;
            threshold = Math.round((threshold - FUZZY_THRESHOLD_STEP) * 10.0) / 10.0;
        }

        Map<UUID, Double> fuzzyScoreMap = new HashMap<>();
        Map<UUID, Map<String, Object>> fuzzyRowMap = new HashMap<>();
        for (Map<String, Object> row : fuzzyResults) {
            UUID id = UUID.fromString(row.get("id").toString());
            double score = row.get("fuzzy_score") != null ? ((Number) row.get("fuzzy_score")).doubleValue() : 0.0;
            fuzzyScoreMap.put(id, score);
            fuzzyRowMap.put(id, row);
        }

        Map<UUID, Double> vectorScoreMap = new HashMap<>();
        Map<UUID, Map<String, Object>> vectorRowMap = new HashMap<>();
        String queryEmbedding = embeddingService.getEmbedding(query);
        if (queryEmbedding != null) {
            List<Map<String, Object>> vectorResults = cardRepository.vectorSearch(userId, queryEmbedding, topK);
            for (Map<String, Object> row : vectorResults) {
                UUID id = UUID.fromString(row.get("id").toString());
                double score = row.get("vector_score") != null ? ((Number) row.get("vector_score")).doubleValue() : 0.0;
                if (score >= VECTOR_MIN_SCORE) {
                    vectorScoreMap.put(id, score);
                    vectorRowMap.put(id, row);
                }
            }
        }

        // fuzzy 결과가 있으면 fuzzy 대상만, 없으면 vector로 fallback
        boolean isFuzzyFallback = fuzzyScoreMap.isEmpty();
        Set<UUID> allIds = new HashSet<>(isFuzzyFallback ? vectorScoreMap.keySet() : fuzzyScoreMap.keySet());

        List<CardResponse> results = new ArrayList<>();
        for (UUID id : allIds) {
            double fuzzyScore = fuzzyScoreMap.getOrDefault(id, 0.0);
            double vectorScore = vectorScoreMap.getOrDefault(id, 0.0);
            double combinedScore = fuzzyScore * FUZZY_WEIGHT + vectorScore * VECTOR_WEIGHT;

            if (isFuzzyFallback) {
                if (vectorScore < VECTOR_MIN_SCORE) continue;
            } else if (combinedScore < MIN_COMBINED_SCORE) {
                continue;
            }

            Map<String, Object> row = fuzzyRowMap.containsKey(id) ? fuzzyRowMap.get(id) : vectorRowMap.get(id);
            CardResponse response = mapRowToCardResponse(row);
            response.setSimilarity(combinedScore);
            results.add(response);
        }

        results.sort((a, b) -> Double.compare(b.getSimilarity(), a.getSimilarity()));
        return results.stream().limit(topK).toList();
    }

    private CardResponse mapRowToCardResponse(Map<String, Object> row) {
        CardResponse cardResponse = new CardResponse();
        cardResponse.setId(UUID.fromString(row.get("id").toString()));
        cardResponse.setName((String) row.get("name"));
        cardResponse.setCompany((String) row.get("company"));
        cardResponse.setPosition((String) row.get("position"));
        cardResponse.setPhone((String) row.get("phone"));
        cardResponse.setEmail((String) row.get("email"));
        cardResponse.setRawOcrText((String) row.get("raw_ocr_text"));
        cardResponse.setImageUrl((String) row.get("image_url"));
        Object groupId = row.get("group_id");
        if (groupId != null) {
            cardResponse.setGroupId(UUID.fromString(groupId.toString()));
        }
        Object createdAtObj = row.get("created_at");
        if (createdAtObj instanceof Instant) {
            cardResponse.setCreatedAt(((Instant) createdAtObj).atZone(ZoneId.systemDefault()).toLocalDateTime());
        } else if (createdAtObj instanceof java.sql.Timestamp) {
            cardResponse.setCreatedAt(((java.sql.Timestamp) createdAtObj).toLocalDateTime());
        }
        return cardResponse;
    }

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

    private void deleteImageIfUploaded(String imageUrl) {
        if (imageUrl != null && imageUrl.startsWith("/uploads/")) {
            ocrService.deleteImage(imageUrl.substring("/uploads/".length()));
        }
    }

    private void setGroupIfOwned(BusinessCard card, UUID userId, UUID groupId) {
        if (groupId == null) {
            card.setGroupId(null);
            return;
        }

        groupRepository.findByIdAndUserId(groupId, userId)
                .orElseThrow(() -> new RuntimeException("Card group not found"));
        card.setGroupId(groupId);
    }
}
