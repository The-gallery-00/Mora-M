package com.mora.service;

import com.mora.dto.ReceiptItemRequest;
import com.mora.dto.ReceiptResponse;
import com.mora.dto.ReceiptSaveRequest;
import com.mora.entity.Receipt;
import com.mora.entity.ReceiptItem;
import com.mora.repository.ReceiptRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
@Transactional(readOnly = true)
public class ReceiptService {

    private static final double FUZZY_THRESHOLD_START = 1.0;
    private static final double FUZZY_THRESHOLD_STEP = 0.1;
    private static final int FUZZY_MAX_ITERATIONS = 8;
    private static final double FUZZY_WEIGHT = 0.6;
    private static final double VECTOR_WEIGHT = 0.4;
    private static final double VECTOR_MIN_SCORE = 0.3;
    private static final double MIN_COMBINED_SCORE = 0.4;

    private static final List<DateTimeFormatter> DATE_FORMATTERS_WITH_YEAR = List.of(
            DateTimeFormatter.ofPattern("yyyy-MM-dd"),
            DateTimeFormatter.ofPattern("yyyy.MM.dd"),
            DateTimeFormatter.ofPattern("yyyy/MM/dd"),
            DateTimeFormatter.ofPattern("yyyy년 M월 d일")
    );

    private final ReceiptRepository receiptRepository;
    private final EmbeddingService embeddingService;

    public ReceiptService(ReceiptRepository receiptRepository, EmbeddingService embeddingService) {
        this.receiptRepository = receiptRepository;
        this.embeddingService = embeddingService;
    }

    @Transactional
    public ReceiptResponse save(UUID userId, ReceiptSaveRequest request) {
        String rawTextJoined = joinRawText(request.getRawText());

        Receipt receipt = new Receipt();
        receipt.setUserId(userId);
        receipt.setDocType(defaultIfBlank(request.getDocType(), "RECEIPT"));
        applyFields(receipt, request);
        receipt.setRawText(rawTextJoined);
        receipt.setParsedJson(request.getParsedJson());
        receipt.setRawJson(request.getRawJson());
        receipt.replaceItems(toItems(request.getItems()));
        receipt.setEmbedding(embeddingService.getEmbedding(rawTextJoined));

        return ReceiptResponse.from(receiptRepository.save(receipt));
    }

    public ReceiptResponse findById(UUID userId, Integer receiptId) {
        Receipt receipt = receiptRepository.findByIdAndUserId(receiptId, userId)
                .orElseThrow(() -> new RuntimeException("Receipt not found or unauthorized"));
        return ReceiptResponse.from(receipt);
    }

    public Page<ReceiptResponse> listByUser(UUID userId, int page, int size) {
        PageRequest pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        return receiptRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable)
                .map(ReceiptResponse::from);
    }

    @Transactional
    public ReceiptResponse update(UUID userId, Integer receiptId, ReceiptSaveRequest request) {
        Receipt receipt = receiptRepository.findByIdAndUserId(receiptId, userId)
                .orElseThrow(() -> new RuntimeException("Receipt not found or unauthorized"));

        if (request.getDocType() != null) receipt.setDocType(defaultIfBlank(request.getDocType(), "RECEIPT"));
        applyFields(receipt, request);
        if (request.getParsedJson() != null) receipt.setParsedJson(request.getParsedJson());
        if (request.getRawJson() != null) receipt.setRawJson(request.getRawJson());
        if (request.getItems() != null) receipt.replaceItems(toItems(request.getItems()));

        if (request.getRawText() != null && !request.getRawText().isEmpty()) {
            String rawTextJoined = joinRawText(request.getRawText());
            receipt.setRawText(rawTextJoined);
            receipt.setEmbedding(embeddingService.getEmbedding(rawTextJoined));
        }

        return ReceiptResponse.from(receiptRepository.save(receipt));
    }

    @Transactional
    public void delete(UUID userId, Integer receiptId) {
        Receipt receipt = receiptRepository.findByIdAndUserId(receiptId, userId)
                .orElseThrow(() -> new RuntimeException("Receipt not found or unauthorized"));
        receiptRepository.delete(receipt);
    }

    // 하이브리드 검색: fuzzy(pg_trgm)*0.6 + vector(pgvector)*0.4, 결합점수 0.4 미만 제외
    public List<ReceiptResponse> hybridSearch(UUID userId, String query, int topK) {
        double threshold = FUZZY_THRESHOLD_START;
        List<Map<String, Object>> fuzzyResults = Collections.emptyList();

        for (int i = 0; i < FUZZY_MAX_ITERATIONS && fuzzyResults.size() < topK; i++) {
            fuzzyResults = receiptRepository.fuzzySearch(userId, query, threshold, topK);
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
            List<Map<String, Object>> vectorResults = receiptRepository.vectorSearch(userId, queryEmbedding, topK);
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

        List<ReceiptResponse> results = new ArrayList<>();
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
            ReceiptResponse response = mapRowToReceiptResponse(row);
            response.setSimilarity(combinedScore);
            results.add(response);
        }

        results.sort((a, b) -> Double.compare(b.getSimilarity(), a.getSimilarity()));
        return results.stream().limit(topK).toList();
    }

    private void applyFields(Receipt receipt, ReceiptSaveRequest request) {
        if (request.getClassificationConfidence() != null) receipt.setClassificationConfidence(request.getClassificationConfidence());
        if (request.getMerchantName() != null) receipt.setMerchantName(request.getMerchantName());
        if (request.getMerchantAddress() != null) receipt.setMerchantAddress(request.getMerchantAddress());
        if (request.getPurchaseDate() != null) receipt.setPurchaseDate(parseDate(request.getPurchaseDate()));
        if (request.getPurchaseTime() != null) receipt.setPurchaseTime(parseTime(request.getPurchaseTime()));
        if (request.getPaymentMethod() != null) receipt.setPaymentMethod(request.getPaymentMethod());
        if (request.getCardCompany() != null) receipt.setCardCompany(request.getCardCompany());
        if (request.getTotalAmount() != null) receipt.setTotalAmount(request.getTotalAmount());
        if (request.getCurrencyCode() != null) receipt.setCurrencyCode(defaultIfBlank(request.getCurrencyCode(), "KRW"));
    }

    private List<ReceiptItem> toItems(List<ReceiptItemRequest> requests) {
        if (requests == null) return List.of();
        return requests.stream()
                .filter(item -> item.getItemName() != null && !item.getItemName().isBlank())
                .map(this::toItem)
                .toList();
    }

    private ReceiptItem toItem(ReceiptItemRequest request) {
        ReceiptItem item = new ReceiptItem();
        item.setItemName(request.getItemName());
        item.setQuantity(request.getQuantity());
        item.setUnitPrice(request.getUnitPrice());
        item.setTotalPrice(request.getTotalPrice());
        item.setCategory(request.getCategory());
        return item;
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

        try {
            if (cleaned.matches("\\d{1,2}\\.\\d{1,2}")) {
                String[] parts = cleaned.split("\\.");
                return LocalDate.of(LocalDate.now().getYear(), Integer.parseInt(parts[0]), Integer.parseInt(parts[1]));
            }
            if (cleaned.matches("\\d{1,2}월\\s*\\d{1,2}일")) {
                String[] parts = cleaned.replace("일", "").split("월");
                return LocalDate.of(LocalDate.now().getYear(), Integer.parseInt(parts[0].trim()), Integer.parseInt(parts[1].trim()));
            }
        } catch (Exception ignored) {
        }

        return null;
    }

    private LocalTime parseTime(String timeStr) {
        if (timeStr == null || timeStr.isBlank()) return null;
        String cleaned = timeStr.trim();

        for (String pattern : List.of("H:mm", "H:mm:ss")) {
            try {
                return LocalTime.parse(cleaned, DateTimeFormatter.ofPattern(pattern));
            } catch (Exception ignored) {
            }
        }

        try {
            String lower = cleaned.toLowerCase(Locale.ROOT);
            boolean isPm = cleaned.contains("오후") || lower.contains("pm");
            boolean isAm = cleaned.contains("오전") || lower.contains("am");
            if (isPm || isAm) {
                String[] parts = cleaned.replaceAll("[^0-9]", " ").trim().split("\\s+");
                int hour = Integer.parseInt(parts[0]);
                int minute = parts.length >= 2 ? Integer.parseInt(parts[1]) : 0;
                if (isPm && hour < 12) hour += 12;
                if (isAm && hour == 12) hour = 0;
                return LocalTime.of(hour, minute);
            }
        } catch (Exception ignored) {
        }

        return null;
    }

    private String joinRawText(List<String> rawTextList) {
        if (rawTextList == null || rawTextList.isEmpty()) return "";
        return String.join(" ", rawTextList);
    }

    private String defaultIfBlank(String value, String defaultValue) {
        return value == null || value.isBlank() ? defaultValue : value;
    }

    private ReceiptResponse mapRowToReceiptResponse(Map<String, Object> row) {
        ReceiptResponse response = new ReceiptResponse();
        response.setId(((Number) row.get("id")).intValue());
        response.setUserId(UUID.fromString(row.get("user_id").toString()));
        response.setDocType((String) row.get("doc_type"));
        response.setMerchantName((String) row.get("merchant_name"));
        response.setMerchantAddress((String) row.get("merchant_address"));
        response.setPaymentMethod((String) row.get("payment_method"));
        response.setCardCompany((String) row.get("card_company"));
        response.setRawText((String) row.get("raw_text"));
        response.setParsedJson(row.get("parsed_json") != null ? row.get("parsed_json").toString() : null);
        response.setRawJson(row.get("raw_json") != null ? row.get("raw_json").toString() : null);
        response.setCurrencyCode((String) row.get("currency_code"));
        response.setItems(List.of());

        if (row.get("classification_confidence") != null) {
            response.setClassificationConfidence(new java.math.BigDecimal(row.get("classification_confidence").toString()));
        }
        if (row.get("total_amount") != null) {
            response.setTotalAmount(new java.math.BigDecimal(row.get("total_amount").toString()));
        }
        if (row.get("purchase_date") instanceof java.sql.Date purchaseDate) {
            response.setPurchaseDate(purchaseDate.toLocalDate());
        }
        if (row.get("purchase_time") instanceof java.sql.Time purchaseTime) {
            response.setPurchaseTime(purchaseTime.toLocalTime());
        }
        response.setCreatedAt(toLocalDateTime(row.get("created_at")));
        response.setUpdatedAt(toLocalDateTime(row.get("updated_at")));
        return response;
    }

    private LocalDateTime toLocalDateTime(Object obj) {
        if (obj instanceof Instant instant) {
            return instant.atZone(ZoneId.systemDefault()).toLocalDateTime();
        } else if (obj instanceof java.sql.Timestamp timestamp) {
            return timestamp.toLocalDateTime();
        }
        return null;
    }
}
