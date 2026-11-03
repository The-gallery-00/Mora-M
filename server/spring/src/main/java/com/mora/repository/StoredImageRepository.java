package com.mora.repository;

import com.mora.entity.StoredImage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface StoredImageRepository extends JpaRepository<StoredImage, String> {
    List<StoredImage> findByUserIdOrderByImageName(UUID userId);

    List<StoredImage> findByUserIdAndCreatedAtBeforeOrderByImageName(UUID userId, Instant cutoff);

    @Query("select distinct i.userId from StoredImage i where i.createdAt < :cutoff")
    List<UUID> findCleanupOwners(@Param("cutoff") Instant cutoff);
}
