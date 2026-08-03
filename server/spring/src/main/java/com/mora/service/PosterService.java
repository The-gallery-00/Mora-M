package com.mora.service;

import com.mora.dto.PosterResponse;
import com.mora.dto.PosterRequest;
import com.mora.entity.Poster;
import com.mora.repository.PosterRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
public class PosterService {

    private static final List<DateTimeFormatter> DATE_FORMATTERS_WITH_YEAR = List.of(
            DateTimeFormatter.ofPattern("yyyy-MM-dd"),
            DateTimeFormatter.ofPattern("yyyy.MM.dd"),
            DateTimeFormatter.ofPattern("yyyy/MM/dd"),
            DateTimeFormatter.ofPattern("yyyy년 MM월 dd일")
    );

    private static final double FUZZY_THRESHOLD_START = 1.0;
    private static final double FUZZY_THRESHOLD_STEP = 0.1;
    private static final int FUZZY_MAX_ITERATIONS = 8;
    private static final double FUZZY_WEIGHT = 0.6;
    private static final double VECTOR_WEIGHT = 0.4;
    private static final double VECTOR_MIN_SCORE = 0.3;
    private static final double MIN_COMBINED_SCORE = 0.4;

    private final PosterRepository posterRepository;
    private final EmbeddingService embeddingService;

    public PosterService(PosterRepository posterRepository, EmbeddingService embeddingService) {
        this.posterRepository = posterRepository;
        this.embeddingService = embeddingService;
    }

    public PosterResponse save(UUID userId, PosterRequest request) {
        String rawTextJoined = joinRawText(request.getRawText());
        String embedding = embeddingService.getEmbedding(rawTextJoined);

        Poster poster = new Poster();
        poster.setUserId(userId);
        poster.setDocType(request.getDocType());
        poster.setClassificationConfidence(request.getClassificationConfidence());
        poster.setTitle(request.getTitle());
        poster.setOrganizerName(request.getOrganizerName());
        poster.setEventStartDate(parseDate(request.getEventStartDate()));
        poster.setEventEndDate(parseDate(request.getEventEndDate()));
        poster.setContactPhone(request.getContactPhone());
        poster.setContactEmail(request.getContactEmail());
        poster.setLocation(request.getLocation());
        poster.setFee(request.getFee());
        poster.setWebsiteUrl(request.getWebsiteUrl());
        poster.setDescription(request.getDescription());
        poster.setRawText(rawTextJoined);
        poster.setParsedJson(request.getParsedJson());
        poster.setRawJson(request.getRawJson());
        poster.setEmbedding(embedding);

        poster = posterRepository.save(poster);
        return PosterResponse.from(poster);
    }

    public PosterResponse findById(UUID userId, Integer posterId) {
        Poster poster = posterRepository.findByIdAndUserId(posterId, userId)
                .orElseThrow(() -> new RuntimeException("Poster not found or unauthorized"));
        return PosterResponse.from(poster);
    }

    public Page<PosterResponse> listByUser(UUID userId, int page, int size) {
        PageRequest pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        return posterRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable)
                .map(PosterResponse::from);
    }

    public PosterResponse update(UUID userId, Integer posterId, PosterRequest request) {
        Poster poster = posterRepository.findByIdAndUserId(posterId, userId)
                .orElseThrow(() -> new RuntimeException("Poster not found or unauthorized"));

        if (request.getDocType() != null) poster.setDocType(request.getDocType());
        if (request.getClassificationConfidence() != null) poster.setClassificationConfidence(request.getClassificationConfidence());
        if (request.getTitle() != null) poster.setTitle(request.getTitle());
        if (request.getOrganizerName() != null) poster.setOrganizerName(request.getOrganizerName());
        if (request.getEventStartDate() != null) poster.setEventStartDate(parseDate(request.getEventStartDate()));
        if (request.getEventEndDate() != null) poster.setEventEndDate(parseDate(request.getEventEndDate()));
        if (request.getContactPhone() != null) poster.setContactPhone(request.getContactPhone());
        if (request.getContactEmail() != null) poster.setContactEmail(request.getContactEmail());
        if (request.getLocation() != null) poster.setLocation(request.getLocation());
        if (request.getFee() != null) poster.setFee(request.getFee());
        if (request.getWebsiteUrl() != null) poster.setWebsiteUrl(request.getWebsiteUrl());
        if (request.getDescription() != null) poster.setDescription(request.getDescription());
        if (request.getParsedJson() != null) poster.setParsedJson(request.getParsedJson());
        if (request.getRawJson() != null) poster.setRawJson(request.getRawJson());

        if (request.getRawText() != null && !request.getRawText().isEmpty()) {
            String rawTextJoined = joinRawText(request.getRawText());
            poster.setRawText(rawTextJoined);
            poster.setEmbedding(embeddingService.getEmbedding(rawTextJoined));
        }

        poster = posterRepository.save(poster);
        return PosterResponse.from(poster);
    }

    public void delete(UUID userId, Integer posterId) {
        Poster poster = posterRepository.findByIdAndUserId(posterId, userId)
                .orElseThrow(() -> new RuntimeException("Poster not found or unauthorized"));
        posterRepository.delete(poster);
    }

    // 하이브리드 검색: fuzzy(pg_trgm)*0.6 + vector(pgvector)*0.4, 결합점수 0.4 미만 제외
    public List<PosterResponse> hybridSearch(UUID userId, String query, int topK) {
        double threshold = FUZZY_THRESHOLD_START;
        List<Map<String, Object>> fuzzyResults = Collections.emptyList();

        for (int i = 0; i < FUZZY_MAX_ITERATIONS && fuzzyResults.size() < topK; i++) {
            fuzzyResults = posterRepository.fuzzySearch(userId, query, threshold, topK);
            if (fuzzyResults.size() >= topK) break;
            threshold = Math.round((threshold - FUZZY_THRESHOLD_STEP) * 10.0) / 10.0;
        }

        Map<Integer, Double> fuzzyScoreMap = new HashMap<>();
        Map<Integer, Map<String, Object>> fuzzyRowMap = new HashMap<>();
        for (Map<String, Object> row : fuzzyResults) {
            Integer id = ((Number) row.get("id")).intValue();
            double score = row.get("fuzzy_score") != null ? ((Number) row.get("fuzzy_score")).doubleValue() : 0.0;
            fuzzyScoreMap.put(id, score);
            fuzzyRowMap.put(id, row);
        }

        Map<Integer, Double> vectorScoreMap = new HashMap<>();
        Map<Integer, Map<String, Object>> vectorRowMap = new HashMap<>();
        String queryEmbedding = embeddingService.getEmbedding(query);
        if (queryEmbedding != null) {
            List<Map<String, Object>> vectorResults = posterRepository.vectorSearch(userId, queryEmbedding, topK);
            for (Map<String, Object> row : vectorResults) {
                Integer id = ((Number) row.get("id")).intValue();
                double score = row.get("vector_score") != null ? ((Number) row.get("vector_score")).doubleValue() : 0.0;
                if (score >= VECTOR_MIN_SCORE) {
                    vectorScoreMap.put(id, score);
                    vectorRowMap.put(id, row);
                }
            }
        }

        boolean isFuzzyFallback = fuzzyScoreMap.isEmpty();
        Set<Integer> allIds = new HashSet<>(isFuzzyFallback ? vectorScoreMap.keySet() : fuzzyScoreMap.keySet());

        List<PosterResponse> results = new ArrayList<>();
        for (Integer id : allIds) {
            double fuzzyScore = fuzzyScoreMap.getOrDefault(id, 0.0);
            double vectorScore = vectorScoreMap.getOrDefault(id, 0.0);
            double combinedScore = fuzzyScore * FUZZY_WEIGHT + vectorScore * VECTOR_WEIGHT;

            if (isFuzzyFallback) {
                if (vectorScore < VECTOR_MIN_SCORE) continue;
            } else if (combinedScore < MIN_COMBINED_SCORE) {
                continue;
            }

            Map<String, Object> row = fuzzyRowMap.containsKey(id) ? fuzzyRowMap.get(id) : vectorRowMap.get(id);
            PosterResponse response = mapRowToPosterResponse(row);
            response.setSimilarity(combinedScore);
            results.add(response);
        }

        results.sort((a, b) -> Double.compare(b.getSimilarity(), a.getSimilarity()));
        return results.stream().limit(topK).toList();
    }

    private LocalDate parseDate(String dateStr) {
        if (dateStr == null || dateStr.isBlank()) return null;

        String cleaned = dateStr.replaceAll("\\([^)]*\\)", "").trim();
        for (DateTimeFormatter formatter : DATE_FORMATTERS_WITH_YEAR) {
            try {
                return LocalDate.parse(cleaned, formatter);
            } catch (Exception ignored) {
            }
        }

        if (cleaned.matches("\\d{1,2}\\.\\d{1,2}")) {
            try {
                String[] parts = cleaned.split("\\.");
                return LocalDate.of(LocalDate.now().getYear(), Integer.parseInt(parts[0]), Integer.parseInt(parts[1]));
            } catch (Exception ignored) {
            }
        }
        if (cleaned.contains("월") && cleaned.contains("일")) {
            try {
                String monthStr = cleaned.replaceAll("월.*", "").trim();
                String dayStr = cleaned.replaceAll(".*월\\s*", "").replaceAll("일", "").trim();
                return LocalDate.of(LocalDate.now().getYear(), Integer.parseInt(monthStr), Integer.parseInt(dayStr));
            } catch (Exception ignored) {
            }
        }

        return null;
    }

    private String joinRawText(List<String> rawTextList) {
        if (rawTextList == null || rawTextList.isEmpty()) return "";
        return String.join(" ", rawTextList);
    }

    private PosterResponse mapRowToPosterResponse(Map<String, Object> row) {
        PosterResponse response = new PosterResponse();
        response.setId(((Number) row.get("id")).intValue());
        response.setUserId(UUID.fromString(row.get("user_id").toString()));
        response.setDocType((String) row.get("doc_type"));
        response.setTitle((String) row.get("title"));
        response.setOrganizerName((String) row.get("organizer_name"));
        response.setContactPhone((String) row.get("contact_phone"));
        response.setContactEmail((String) row.get("contact_email"));
        response.setLocation((String) row.get("location"));
        response.setFee((String) row.get("fee"));
        response.setWebsiteUrl((String) row.get("website_url"));
        response.setDescription((String) row.get("description"));
        response.setRawText((String) row.get("raw_text"));
        response.setParsedJson(row.get("parsed_json") != null ? row.get("parsed_json").toString() : null);
        response.setRawJson(row.get("raw_json") != null ? row.get("raw_json").toString() : null);
        response.setCreatedAt(toLocalDateTime(row.get("created_at")));
        response.setUpdatedAt(toLocalDateTime(row.get("updated_at")));

        if (row.get("event_start_date") instanceof java.sql.Date startDate) {
            response.setEventStartDate(startDate.toLocalDate());
        }
        if (row.get("event_end_date") instanceof java.sql.Date endDate) {
            response.setEventEndDate(endDate.toLocalDate());
        }
        if (row.get("classification_confidence") != null) {
            response.setClassificationConfidence(new java.math.BigDecimal(row.get("classification_confidence").toString()));
        }

        return response;
    }

    private java.time.LocalDateTime toLocalDateTime(Object obj) {
        if (obj instanceof Instant instant) {
            return instant.atZone(java.time.ZoneId.systemDefault()).toLocalDateTime();
        }
        if (obj instanceof java.sql.Timestamp timestamp) {
            return timestamp.toLocalDateTime();
        }
        return null;
    }
}
