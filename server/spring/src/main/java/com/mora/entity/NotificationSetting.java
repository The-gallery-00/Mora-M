package com.mora.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.UUID;

@Getter @Setter @NoArgsConstructor
@Entity @Table(name = "notification_settings")
public class NotificationSetting {
    @Id @Column(name = "user_id") private UUID userId;
    @Column(name = "deadline_reminder_days", nullable = false) private Integer deadlineReminderDays = 3;
    @Column(name = "deadline_reminder_enabled", nullable = false) private Boolean deadlineReminderEnabled = true;
    @Column(name = "schedule_reminder_enabled", nullable = false) private Boolean scheduleReminderEnabled = true;
    @Column(name = "created_at", updatable = false) private LocalDateTime createdAt;
    @Column(name = "updated_at") private LocalDateTime updatedAt;

    @PrePersist void onCreate() { createdAt = LocalDateTime.now(); updatedAt = createdAt; }
    @PreUpdate void onUpdate() { updatedAt = LocalDateTime.now(); }
}
