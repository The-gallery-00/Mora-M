package com.mora.repository;

import com.mora.entity.Notification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.LocalDateTime;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {
    Page<Notification> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);
    Optional<Notification> findByIdAndUserId(UUID id, UUID userId);
    long countByUserIdAndReadAtIsNull(UUID userId);
    long deleteByUserId(UUID userId);
    @Modifying
    @Query("update Notification n set n.readAt = :readAt where n.userId = :userId and n.readAt is null")
    int markAllRead(@Param("userId") UUID userId, @Param("readAt") LocalDateTime readAt);
    boolean existsByUserIdAndTypeAndSourceTypeAndSourceIdAndTargetDate(
            UUID userId, String type, String sourceType, String sourceId, LocalDate targetDate);
}
