package com.mora.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mora.entity.StoredImage;
import com.mora.repository.StoredImageRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
@Transactional
public class StoredImageService {
    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,199}");
    private static final List<String> IMAGE_KEYS = List.of("imageUrl", "image_url");
    private static final String REFERENCED_SQL = """
            SELECT EXISTS (
                SELECT 1 FROM business_cards WHERE user_id = ? AND stored_image_name(image_url) = ?
                UNION ALL
                SELECT 1 FROM posters WHERE user_id = ? AND
                    (? = ANY(stored_image_json_names(parsed_json)) OR ? = ANY(stored_image_json_names(raw_json)))
                UNION ALL
                SELECT 1 FROM tickets WHERE user_id = ? AND
                    (? = ANY(stored_image_json_names(parsed_json)) OR ? = ANY(stored_image_json_names(raw_json)))
                UNION ALL
                SELECT 1 FROM receipts WHERE user_id = ? AND
                    (? = ANY(stored_image_json_names(parsed_json)) OR ? = ANY(stored_image_json_names(raw_json)))
            )
            """;

    private final StoredImageRepository repository;
    private final OcrService ocrService;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final StoredImageDeletionService deletions;
    private final StoredImageRegistrationService registration;

    public StoredImageService(StoredImageRepository repository, OcrService ocrService,
                              JdbcTemplate jdbc, ObjectMapper mapper, StoredImageDeletionService deletions,
                              StoredImageRegistrationService registration) {
        this.repository = repository;
        this.ocrService = ocrService;
        this.jdbc = jdbc;
        this.deletions = deletions;
        this.registration = registration;
        this.mapper = mapper.copy().enable(DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY)
                .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }

    // All document/image mutations take this lock BEFORE loading documents. It also
    // prevents uploads/attachments racing account deletion, even for an empty registry.
    @Transactional(propagation = Propagation.MANDATORY)
    public void lockOwner(UUID userId) {
        if (userId == null || jdbc.queryForList("SELECT id FROM users WHERE id = ? FOR UPDATE",
                UUID.class, userId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found");
        }
    }

    /** Trusted server upload responses only. Never call with a document request field. */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void registerUpload(UUID userId, String imageUrl) {
        String name = referenceName(imageUrl);
        if (name == null || userId == null) throw invalid("Upload image and owner are required");
        // The registration proxy has committed and released its connection before
        // compensation opens a transaction, even when every pool slot was occupied.
        if (!registration.register(userId, name)) {
            if (deletions.enqueueUnclaimed(name)) {
                deletions.deleteQueued(name);
            }
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found");
        }
    }

    @Transactional(readOnly = true)
    public ResponseEntity<byte[]> readImage(UUID userId, String imageName) {
        validateName(imageName);
        requireOwner(userId, imageName);
        return ocrService.fetchImage(imageName);
    }

    public String normalizeOwnedReference(UUID userId, String imageUrl) {
        lockOwner(userId);
        String name = referenceName(imageUrl);
        if (name == null) return imageUrl;
        requireOwner(userId, name);
        return "/uploads/" + name;
    }

    public String normalizeOwnedJson(UUID userId, String json) {
        lockOwner(userId);
        if (json == null || json.isBlank()) return null;
        JsonNode root = parseDocumentJson(json);
        normalizeTree(userId, root);
        return root.toString();
    }

    public void deleteAll(UUID userId) {
        lockOwner(userId);
        for (StoredImage image : repository.findByUserIdOrderByImageName(userId)) {
            // Do not swallow upstream failures: the caller's transaction must roll back.
            ocrService.deleteImage(image.getImageName());
            repository.delete(image);
        }
        repository.flush();
    }

    public void deleteIfUnreferenced(UUID userId, String imageUrl) {
        lockOwner(userId);
        String name = referenceName(imageUrl);
        if (name == null) return;
        StoredImage image = requireOwner(userId, name);
        // The document service flushes its removal/replacement before this JDBC check.
        Boolean referenced = jdbc.queryForObject(REFERENCED_SQL, Boolean.class,
                userId, name, userId, name, name, userId, name, name, userId, name, name);
        if (Boolean.FALSE.equals(referenced)) {
            ocrService.deleteImage(name);
            repository.delete(image);
            repository.flush();
        } else if (referenced == null) {
            throw new IllegalStateException("Cannot establish image references");
        }
    }

    @Transactional(readOnly = true)
    public List<UUID> findCleanupOwners(Instant cutoff) {
        return repository.findCleanupOwners(cutoff);
    }

    public void cleanupExpired(UUID userId, Instant cutoff) {
        lockOwner(userId);
        for (StoredImage image : repository.findByUserIdAndCreatedAtBeforeOrderByImageName(userId, cutoff)) {
            deleteIfUnreferenced(userId, "/uploads/" + image.getImageName());
        }
    }

    /** Extract old references before modifying a document; same parser as validation. */
    public Set<String> referencesInJson(String... documents) {
        Set<String> references = new LinkedHashSet<>();
        for (String json : documents) {
            if (json != null && !json.isBlank()) collectReferences(parseDocumentJson(json), references);
        }
        return references;
    }

    private StoredImage requireOwner(UUID userId, String name) {
        return repository.findById(name).filter(image -> image.getUserId().equals(userId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Image not found"));
    }

    private JsonNode parseDocumentJson(String json) {
        try {
            JsonNode root = mapper.readTree(json);
            // Legacy JSONB may contain one JSON-encoded object/array instead of the object itself.
            if (root != null && root.isTextual()) root = mapper.readTree(root.textValue());
            if (root == null || !(root.isObject() || root.isArray() || root.isNull())) {
                throw invalid("Unsupported document JSON");
            }
            return root;
        } catch (JsonProcessingException e) {
            throw invalid("Invalid document JSON");
        }
    }

    private void normalizeTree(UUID userId, JsonNode node) {
        if (node.isObject()) {
            ObjectNode object = (ObjectNode) node;
            for (String key : IMAGE_KEYS) {
                if (object.has(key) && !object.get(key).isNull()) {
                    if (!object.get(key).isTextual()) throw invalid("Invalid image reference");
                    object.put(key, normalizeOwnedReference(userId, object.get(key).textValue()));
                }
            }
        }
        for (JsonNode child : node) normalizeTree(userId, child);
    }

    private void collectReferences(JsonNode node, Set<String> references) {
        if (node.isObject()) {
            for (String key : IMAGE_KEYS) {
                JsonNode value = node.get(key);
                if (value != null && !value.isNull()) {
                    if (!value.isTextual()) throw invalid("Invalid image reference");
                    String name = referenceName(value.textValue());
                    if (name != null) references.add("/uploads/" + name);
                }
            }
        }
        for (JsonNode child : node) collectReferences(child, references);
    }

    private static String referenceName(String value) {
        if (value == null || value.isEmpty()) return null;
        try {
            URI uri = URI.create(value);
            if (uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getRawUserInfo() != null
                    || (uri.isAbsolute() && (!("http".equalsIgnoreCase(uri.getScheme())
                    || "https".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null))
                    || (!uri.isAbsolute() && uri.getRawAuthority() != null)) {
                throw invalid("Invalid image reference");
            }
            String path = uri.getRawPath();
            if (path == null || !path.startsWith("/uploads/")) throw invalid("Invalid image reference");
            String name = path.substring("/uploads/".length());
            validateName(name);
            return name;
        } catch (IllegalArgumentException e) {
            throw invalid("Invalid image reference");
        }
    }

    private static void validateName(String name) {
        if (name == null || !SAFE_NAME.matcher(name).matches() || name.contains("..")) {
            throw invalid("Invalid image name");
        }
    }

    private static ResponseStatusException invalid(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
