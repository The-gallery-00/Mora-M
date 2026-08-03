package com.mora.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

@Getter @Setter @NoArgsConstructor
@Entity @Table(name = "notifications")
public class Notification {
    @Id @GeneratedValue private UUID id;
    @Column(name = "user_id", nullable = false) private UUID userId;
    @Column(nullable = false, length = 30) private String type;
    @Column(nullable = false, length = 200) private String title;
    @Column(nullable = false, columnDefinition = "TEXT") private String message;
    @Column(name = "link_url", columnDefinition = "TEXT") private String linkUrl;
    @Column(name = "source_type", length = 30) private String sourceType;
    @Column(name = "source_id", length = 64) private String sourceId;
    @Column(name = "target_date") private LocalDate targetDate;
    @Column(name = "read_at") private LocalDateTime readAt;
    @Column(name = "created_at", updatable = false) private LocalDateTime createdAt;

    @PrePersist void onCreate() { if (createdAt == null) createdAt = LocalDateTime.now(); }
}
