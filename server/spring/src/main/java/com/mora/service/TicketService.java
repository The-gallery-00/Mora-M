package com.mora.service;

import com.mora.dto.TicketResponse;
import com.mora.dto.TicketRequest;
import com.mora.entity.Ticket;
import com.mora.repository.TicketRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
public class TicketService {

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

    private final TicketRepository ticketRepository;
    private final EmbeddingService embeddingService;

    public TicketService(TicketRepository ticketRepository, EmbeddingService embeddingService) {
        this.ticketRepository = ticketRepository;
        this.embeddingService = embeddingService;
    }

    public TicketResponse save(UUID userId, TicketRequest request) {
        String rawTextJoined = joinRawText(request.getRawText());
        String embedding = embeddingService.getEmbedding(rawTextJoined);

        Ticket ticket = new Ticket();
        ticket.setUserId(userId);
        ticket.setDocType(request.getDocType());
        ticket.setClassificationConfidence(request.getClassificationConfidence());
        ticket.setTransportType(request.getTransportType());
        ticket.setDepartureLocation(request.getDepartureLocation());
        ticket.setDepartureDate(parseDate(request.getDepartureDate()));
        ticket.setDepartureTime(parseTime(request.getDepartureTime()));
        ticket.setArrivalLocation(request.getArrivalLocation());
        ticket.setArrivalDate(parseDate(request.getArrivalDate()));
        ticket.setArrivalTime(parseTime(request.getArrivalTime()));
        ticket.setRawText(rawTextJoined);
        ticket.setParsedJson(request.getParsedJson());
        ticket.setRawJson(request.getRawJson());
        ticket.setEmbedding(embedding);

        ticket = ticketRepository.save(ticket);
        return TicketResponse.from(ticket);
    }

    public TicketResponse findById(UUID userId, Integer ticketId) {
        Ticket ticket = ticketRepository.findByIdAndUserId(ticketId, userId)
                .orElseThrow(() -> new RuntimeException("Ticket not found or unauthorized"));
        return TicketResponse.from(ticket);
    }

    public Page<TicketResponse> listByUser(UUID userId, int page, int size) {
        PageRequest pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        return ticketRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable)
                .map(TicketResponse::from);
    }

    public TicketResponse update(UUID userId, Integer ticketId, TicketRequest request) {
        Ticket ticket = ticketRepository.findByIdAndUserId(ticketId, userId)
                .orElseThrow(() -> new RuntimeException("Ticket not found or unauthorized"));

        if (request.getDocType() != null) ticket.setDocType(request.getDocType());
        if (request.getClassificationConfidence() != null) ticket.setClassificationConfidence(request.getClassificationConfidence());
        if (request.getTransportType() != null) ticket.setTransportType(request.getTransportType());
        if (request.getDepartureLocation() != null) ticket.setDepartureLocation(request.getDepartureLocation());
        if (request.getDepartureDate() != null) ticket.setDepartureDate(parseDate(request.getDepartureDate()));
        if (request.getDepartureTime() != null) ticket.setDepartureTime(parseTime(request.getDepartureTime()));
        if (request.getArrivalLocation() != null) ticket.setArrivalLocation(request.getArrivalLocation());
        if (request.getArrivalDate() != null) ticket.setArrivalDate(parseDate(request.getArrivalDate()));
        if (request.getArrivalTime() != null) ticket.setArrivalTime(parseTime(request.getArrivalTime()));
        if (request.getParsedJson() != null) ticket.setParsedJson(request.getParsedJson());
        if (request.getRawJson() != null) ticket.setRawJson(request.getRawJson());

        if (request.getRawText() != null && !request.getRawText().isEmpty()) {
            String rawTextJoined = joinRawText(request.getRawText());
            ticket.setRawText(rawTextJoined);
            ticket.setEmbedding(embeddingService.getEmbedding(rawTextJoined));
        }

        ticket = ticketRepository.save(ticket);
        return TicketResponse.from(ticket);
    }

    public void delete(UUID userId, Integer ticketId) {
        Ticket ticket = ticketRepository.findByIdAndUserId(ticketId, userId)
                .orElseThrow(() -> new RuntimeException("Ticket not found or unauthorized"));
        ticketRepository.delete(ticket);
    }

    // 하이브리드 검색: fuzzy(pg_trgm)*0.6 + vector(pgvector)*0.4, 결합점수 0.4 미만 제외
    public List<TicketResponse> hybridSearch(UUID userId, String query, int topK) {
        double threshold = FUZZY_THRESHOLD_START;
        List<Map<String, Object>> fuzzyResults = Collections.emptyList();

        for (int i = 0; i < FUZZY_MAX_ITERATIONS && fuzzyResults.size() < topK; i++) {
            fuzzyResults = ticketRepository.fuzzySearch(userId, query, threshold, topK);
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
            List<Map<String, Object>> vectorResults = ticketRepository.vectorSearch(userId, queryEmbedding, topK);
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

        List<TicketResponse> results = new ArrayList<>();
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
            TicketResponse response = mapRowToTicketResponse(row);
            response.setSimilarity(combinedScore);
            results.add(response);
        }

        results.sort((a, b) -> Double.compare(b.getSimilarity(), a.getSimilarity()));
        return results.stream().limit(topK).toList();
    }

    private LocalDate parseDate(String dateStr) {
        if (dateStr == null || dateStr.isBlank()) return null;

        String cleaned = dateStr.replaceAll("\\([월화수목금토일]\\)", "").trim();
        for (DateTimeFormatter formatter : DATE_FORMATTERS_WITH_YEAR) {
            try {
                return LocalDate.parse(cleaned, formatter);
            } catch (Exception ignored) {
            }
        }

        int currentYear = LocalDate.now().getYear();
        try {
            if (cleaned.matches("\\d{1,2}\\.\\d{1,2}")) {
                String[] parts = cleaned.split("\\.");
                return LocalDate.of(currentYear, Integer.parseInt(parts[0]), Integer.parseInt(parts[1]));
            }
            if (cleaned.contains("월") && cleaned.contains("일")) {
                String monthStr = cleaned.replaceAll("월.*", "").trim();
                String dayStr = cleaned.replaceAll(".*월\\s*", "").replaceAll("일", "").trim();
                return LocalDate.of(currentYear, Integer.parseInt(monthStr), Integer.parseInt(dayStr));
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
            boolean isPm = cleaned.contains("오후");
            boolean isAm = cleaned.contains("오전");
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

    private TicketResponse mapRowToTicketResponse(Map<String, Object> row) {
        TicketResponse response = new TicketResponse();
        response.setId(((Number) row.get("id")).intValue());
        response.setUserId(UUID.fromString(row.get("user_id").toString()));
        response.setDocType((String) row.get("doc_type"));
        response.setTransportType((String) row.get("transport_type"));
        response.setDepartureLocation((String) row.get("departure_location"));
        response.setArrivalLocation((String) row.get("arrival_location"));
        response.setRawText((String) row.get("raw_text"));
        response.setParsedJson(row.get("parsed_json") != null ? row.get("parsed_json").toString() : null);
        response.setRawJson(row.get("raw_json") != null ? row.get("raw_json").toString() : null);

        if (row.get("departure_date") instanceof java.sql.Date departureDate) {
            response.setDepartureDate(departureDate.toLocalDate());
        }
        if (row.get("arrival_date") instanceof java.sql.Date arrivalDate) {
            response.setArrivalDate(arrivalDate.toLocalDate());
        }
        if (row.get("departure_time") instanceof java.sql.Time departureTime) {
            response.setDepartureTime(departureTime.toLocalTime());
        }
        if (row.get("arrival_time") instanceof java.sql.Time arrivalTime) {
            response.setArrivalTime(arrivalTime.toLocalTime());
        }

        response.setCreatedAt(toLocalDateTime(row.get("created_at")));
        response.setUpdatedAt(toLocalDateTime(row.get("updated_at")));

        if (row.get("classification_confidence") != null) {
            response.setClassificationConfidence(new java.math.BigDecimal(row.get("classification_confidence").toString()));
        }

        return response;
    }

    private LocalDateTime toLocalDateTime(Object obj) {
        if (obj instanceof Instant instant) {
            return instant.atZone(ZoneId.systemDefault()).toLocalDateTime();
        }
        if (obj instanceof java.sql.Timestamp timestamp) {
            return timestamp.toLocalDateTime();
        }
        return null;
    }
}
