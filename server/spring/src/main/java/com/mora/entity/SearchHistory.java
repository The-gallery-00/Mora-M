package com.mora.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.UUID;

@Getter @Setter @NoArgsConstructor
@Entity @Table(name = "search_histories")
public class SearchHistory {
    @Id @GeneratedValue private UUID id;
    @Column(name = "user_id", nullable = false) private UUID userId;
    @Column(name = "document_type", nullable = false, length = 30) private String documentType;
    @Column(nullable = false, length = 500) private String query;
    @Column(name = "created_at", updatable = false) private LocalDateTime createdAt;

    @PrePersist void onCreate() { if (createdAt == null) createdAt = LocalDateTime.now(); }
}
