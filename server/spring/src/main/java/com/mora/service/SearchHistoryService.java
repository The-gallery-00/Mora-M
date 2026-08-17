package com.mora.service;

import com.mora.dto.SearchHistoryResponse;
import com.mora.entity.SearchHistory;
import com.mora.repository.SearchHistoryRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class SearchHistoryService {
    private final SearchHistoryRepository repository;
    public SearchHistoryService(SearchHistoryRepository repository) { this.repository = repository; }

    @Transactional
    public void record(UUID userId, String documentType, String query) {
        String normalized = query == null ? "" : query.trim();
        if (normalized.isEmpty()) return;
        SearchHistory history = new SearchHistory();
        history.setUserId(userId);
        history.setDocumentType(documentType);
        history.setQuery(normalized.length() > 500 ? normalized.substring(0, 500) : normalized);
        repository.save(history);
    }

    @Transactional(readOnly = true)
    public List<SearchHistoryResponse> list(UUID userId) {
        return repository.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(SearchHistoryResponse::from).toList();
    }

    @Transactional
    public long clear(UUID userId) { return repository.deleteByUserId(userId); }

    @Transactional
    public long removeByQuery(UUID userId, String documentType, String query) {
        String normalized = query == null ? "" : query.trim();
        if (normalized.isEmpty()) return 0;
        if (documentType == null || documentType.isBlank() || "ALL".equals(documentType)) {
            return repository.deleteByUserIdAndQuery(userId, normalized);
        }
        return repository.deleteByUserIdAndDocumentTypeAndQuery(userId, documentType, normalized);
    }
}
