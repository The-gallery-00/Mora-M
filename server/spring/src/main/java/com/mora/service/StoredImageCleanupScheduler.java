package com.mora.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@Component
public class StoredImageCleanupScheduler {
    private static final Logger log = LoggerFactory.getLogger(StoredImageCleanupScheduler.class);
    private final StoredImageService storedImageService;
    private final StoredImageDeletionService deletions;

    public StoredImageCleanupScheduler(StoredImageService storedImageService, StoredImageDeletionService deletions) {
        this.storedImageService = storedImageService;
        this.deletions = deletions;
    }

    @Scheduled(fixedDelayString = "${app.stored-image-cleanup-delay-ms:3600000}",
            initialDelayString = "${app.stored-image-cleanup-delay-ms:3600000}")
    public void cleanup() {
        for (String name : deletions.findPending()) {
            try {
                deletions.deleteQueued(name);
            } catch (RuntimeException e) {
                log.warn("Stored image compensation failed (type={}); will retry", e.getClass().getSimpleName());
            }
        }
        Instant cutoff = Instant.now().minus(24, ChronoUnit.HOURS);
        for (UUID owner : storedImageService.findCleanupOwners(cutoff)) {
            try {
                // Separate user transactions; failures retain registry rows for the next sweep.
                storedImageService.cleanupExpired(owner, cutoff);
            } catch (RuntimeException e) {
                log.warn("Stored image cleanup failed (type={}); will retry", e.getClass().getSimpleName());
            }
        }
    }
}
