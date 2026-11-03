package com.mora.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/** Durable compensation for uploads finishing after their owner has been deleted. */
@Service
public class StoredImageDeletionService {
    private final JdbcTemplate jdbc;
    private final OcrService ocrService;

    public StoredImageDeletionService(JdbcTemplate jdbc, OcrService ocrService) {
        this.jdbc = jdbc;
        this.ocrService = ocrService;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void lockName(String imageName) {
        // Registration and orphan compensation share a name lock, including absent rows.
        jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", imageName);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void assertNotQueued(String imageName) {
        if (Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM stored_image_deletions WHERE image_name = ?)", Boolean.class, imageName))) {
            throw new IllegalStateException("Image is pending deletion");
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean enqueueUnclaimed(String imageName) {
        lockName(imageName);
        if (isRegistered(imageName)) return false;
        jdbc.update("INSERT INTO stored_image_deletions (image_name) VALUES (?) ON CONFLICT DO NOTHING", imageName);
        return true;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void deleteQueued(String imageName) {
        lockName(imageName);
        if (!Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM stored_image_deletions WHERE image_name = ?)", Boolean.class, imageName))) return;
        if (isRegistered(imageName)) throw new IllegalStateException("Refusing to delete a claimed image");
        ocrService.deleteImage(imageName);
        jdbc.update("DELETE FROM stored_image_deletions WHERE image_name = ?", imageName);
    }

    @Transactional(readOnly = true)
    public List<String> findPending() {
        return jdbc.queryForList("SELECT image_name FROM stored_image_deletions ORDER BY created_at, image_name LIMIT 100",
                String.class);
    }

    private boolean isRegistered(String imageName) {
        Boolean registered = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM stored_images WHERE image_name = ?)", Boolean.class, imageName);
        if (registered == null) throw new IllegalStateException("Cannot establish image ownership");
        return registered;
    }
}
