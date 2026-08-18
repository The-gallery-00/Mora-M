package com.mora.dto;

import com.mora.entity.Notification;
import java.time.LocalDateTime;
import java.util.UUID;

public record NotificationResponse(UUID id, String type, String title, String message,
                                   String linkUrl, String sourceType, String sourceId,
                                   boolean read, LocalDateTime readAt,
                                   LocalDateTime createdAt) {
    public static NotificationResponse from(Notification n) {
        return new NotificationResponse(n.getId(), n.getType(), n.getTitle(), n.getMessage(),
                n.getLinkUrl(), n.getSourceType(), n.getSourceId(),
                n.getReadAt() != null, n.getReadAt(), n.getCreatedAt());
    }
}
