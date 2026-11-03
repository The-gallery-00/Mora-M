package com.mora.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "stored_images")
@Getter
@NoArgsConstructor
public class StoredImage {
    @Id
    @Column(name = "image_name", length = 200)
    private String imageName;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public StoredImage(String imageName, UUID userId) {
        this.imageName = imageName;
        this.userId = userId;
        this.createdAt = Instant.now();
    }
}
