package com.mora.repository;

import com.mora.entity.SearchHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface SearchHistoryRepository extends JpaRepository<SearchHistory, UUID> {
    List<SearchHistory> findByUserIdOrderByCreatedAtDesc(UUID userId);
    long deleteByUserId(UUID userId);
}
