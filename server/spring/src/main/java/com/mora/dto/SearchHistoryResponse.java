package com.mora.dto;

import com.mora.entity.SearchHistory;
import java.time.LocalDateTime;
import java.util.UUID;

public record SearchHistoryResponse(UUID id, String documentType, String query, LocalDateTime createdAt) {
    public static SearchHistoryResponse from(SearchHistory history) {
        return new SearchHistoryResponse(history.getId(), history.getDocumentType(),
                history.getQuery(), history.getCreatedAt());
    }
}
