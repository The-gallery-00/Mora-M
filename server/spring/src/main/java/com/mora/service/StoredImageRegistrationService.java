package com.mora.service;

import com.mora.repository.StoredImageRepository;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

/** Registration transaction only; compensation must run after this proxy returns. */
@Service
public class StoredImageRegistrationService {
    private final StoredImageRepository repository;
    private final JdbcTemplate jdbc;
    private final StoredImageDeletionService deletions;

    public StoredImageRegistrationService(StoredImageRepository repository, JdbcTemplate jdbc,
                                          StoredImageDeletionService deletions) {
        this.repository = repository;
        this.jdbc = jdbc;
        this.deletions = deletions;
    }

    @Transactional
    public boolean register(UUID userId, String imageName) {
        if (jdbc.queryForList("SELECT id FROM users WHERE id = ? FOR UPDATE", UUID.class, userId).isEmpty()) {
            return false;
        }
        deletions.lockName(imageName);
        deletions.assertNotQueued(imageName);
        // ON CONFLICT never transfers ownership, including concurrent cross-user uploads.
        jdbc.update("INSERT INTO stored_images (image_name, user_id, created_at) VALUES (?, ?, now()) "
                + "ON CONFLICT (image_name) DO NOTHING", imageName, userId);
        repository.findById(imageName).filter(image -> image.getUserId().equals(userId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Image not found"));
        return true;
    }
}
