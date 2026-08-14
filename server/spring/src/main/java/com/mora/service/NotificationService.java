package com.mora.service;

import com.mora.dto.NotificationResponse;
import com.mora.entity.Notification;
import com.mora.repository.NotificationRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

@Service
public class NotificationService {
    private static final int MAX_PAGE_SIZE = 50;
    private final NotificationRepository repository;
    private final DeadlineNotificationScheduler notificationScheduler;

    public NotificationService(NotificationRepository repository,
                               DeadlineNotificationScheduler notificationScheduler) {
        this.repository = repository;
        this.notificationScheduler = notificationScheduler;
    }

    @Transactional
    public Page<NotificationResponse> list(UUID userId, int page, int size) {
        notificationScheduler.createForUserNow(userId);
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        return repository.findByUserIdOrderByCreatedAtDesc(userId, PageRequest.of(safePage, safeSize))
                .map(NotificationResponse::from);
    }

    @Transactional
    public Map<String, Long> unreadCount(UUID userId) {
        notificationScheduler.createForUserNow(userId);
        return Map.of("count", repository.countByUserIdAndReadAtIsNull(userId));
    }

    @Transactional
    public NotificationResponse markRead(UUID userId, UUID id) {
        Notification item = owned(userId, id);
        if (item.getReadAt() == null) item.setReadAt(LocalDateTime.now());
        return NotificationResponse.from(repository.save(item));
    }

    @Transactional
    public Map<String, Long> markAllRead(UUID userId) {
        long updated = repository.markAllRead(userId, LocalDateTime.now());
        return Map.of("updatedCount", updated);
    }

    @Transactional public void delete(UUID userId, UUID id) { repository.delete(owned(userId, id)); }
    @Transactional public long deleteAll(UUID userId) { return repository.deleteByUserId(userId); }

    private Notification owned(UUID userId, UUID id) {
        return repository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new IllegalArgumentException("Notification not found"));
    }
}
