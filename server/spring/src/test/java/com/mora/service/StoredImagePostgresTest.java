package com.mora.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import com.mora.repository.StoredImageRepository;
import com.mora.repository.BusinessCardRepository;
import com.mora.repository.CardGroupRepository;
import com.mora.repository.PosterRepository;
import com.mora.repository.TicketRepository;
import com.mora.repository.ReceiptRepository;
import com.mora.dto.CardSaveRequest;
import com.mora.dto.PosterRequest;
import com.mora.dto.TicketRequest;
import com.mora.dto.ReceiptSaveRequest;
import jakarta.persistence.EntityManagerFactory;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.SharedEntityManagerCreator;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Run against a DISPOSABLE pgvector DB with STORED_IMAGE_TEST_DATABASE_URL and password "test". */
@EnabledIfEnvironmentVariable(named = "STORED_IMAGE_TEST_DATABASE_URL", matches = "jdbc:postgresql://127\\.0\\.0\\.1:.*")
class StoredImagePostgresTest {
    private final UUID owner = UUID.randomUUID();
    private final UUID other = UUID.randomUUID();
    private final String schema = "stored_image_test_" + UUID.randomUUID().toString().replace("-", "");
    private final OcrService ocr = mock(OcrService.class);
    private HikariDataSource dataSource;
    private JdbcTemplate admin;
    private JdbcTemplate jdbc;
    private EntityManagerFactory emf;
    private TransactionTemplate transaction;
    private StoredImageService service;
    private StoredImageDeletionService deletions;
    private JpaRepositoryFactory repositories;

    @BeforeEach
    void setUp() {
        String url = System.getenv("STORED_IMAGE_TEST_DATABASE_URL");
        admin = new JdbcTemplate(new DriverManagerDataSource(url, "postgres", "test"));
        admin.execute("CREATE SCHEMA " + schema);
        HikariConfig pool = new HikariConfig();
        pool.setJdbcUrl(url + (url.contains("?") ? "&" : "?") + "stringtype=unspecified&currentSchema=" + schema);
        pool.setUsername("postgres");
        pool.setPassword("test");
        pool.setMaximumPoolSize(3);
        pool.setMinimumIdle(3);
        pool.setConnectionTimeout(2000);
        dataSource = new HikariDataSource(pool);
        jdbc = new JdbcTemplate(dataSource);
        migrate("8");
        jdbc.update("INSERT INTO users (id, email, name) VALUES (?, 'owner@test', 'owner'), (?, 'other@test', 'other')",
                owner, other);
    }

    @AfterEach
    void tearDown() {
        if (emf != null) emf.close();
        if (dataSource != null) dataSource.close();
        if (admin != null) admin.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    }

    @Test
    void fullFlywayBackfillsAllTypesIncludingEncodedJsonNestedFieldsAndBothAliases() throws Exception {
        jdbc.update("INSERT INTO business_cards (user_id, image_url) VALUES (?, ?)", owner,
                "https://legacy.example/uploads/card.jpg");
        String encoded = new ObjectMapper().writeValueAsString("{\"nested\":{\"imageUrl\":\"/uploads/poster.jpg\"}}");
        jdbc.update("INSERT INTO posters (user_id, doc_type, parsed_json, raw_json) VALUES (?, 'POSTER', ?::jsonb, '[]')",
                owner, encoded);
        jdbc.update("INSERT INTO tickets (user_id, doc_type, raw_json) VALUES (?, 'TICKET', ?::jsonb)", owner,
                "[{\"image_url\":\"https://legacy.example/uploads/ticket.jpg\"}]");
        jdbc.update("INSERT INTO receipts (user_id, parsed_json, raw_json) VALUES (?, ?::jsonb, ?::jsonb)", owner,
                "{\"imageUrl\":\"/uploads/receipt.jpg\"}", "{\"image_url\":\"/uploads/receipt.jpg\"}");
        migrate("9");
        assertEquals(List.of("card.jpg", "poster.jpg", "receipt.jpg", "ticket.jpg"),
                jdbc.queryForList("SELECT image_name FROM stored_images ORDER BY image_name", String.class));
        assertEquals(4, jdbc.queryForObject("SELECT count(*) FROM stored_images WHERE user_id = ?", Integer.class, owner));
        assertEquals(9, jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE success AND version IS NOT NULL", Integer.class));
        startService();
        assertThrows(ResponseStatusException.class, () -> transaction.executeWithoutResult(
                status -> service.normalizeOwnedReference(other, "/uploads/poster.jpg")));
        assertThrows(ResponseStatusException.class, () -> transaction.executeWithoutResult(
                status -> service.normalizeOwnedJson(other, "{\"image_url\":\"/uploads/ticket.jpg\"}")));
        for (String name : List.of("card", "poster", "ticket", "receipt")) {
            transaction.executeWithoutResult(status -> service.deleteIfUnreferenced(owner, "/uploads/" + name + ".jpg"));
        }
        verifyNoInteractions(ocr);
        assertThrows(RuntimeException.class, () -> jdbc.queryForObject(
                "SELECT stored_image_name(?)", String.class, "/uploads/" + "a".repeat(201)));
        assertEquals("a".repeat(200), jdbc.queryForObject("SELECT stored_image_name(?)", String.class,
                "/uploads/" + "a".repeat(200)));
    }

    @Test
    void conflictingLegacyOwnersAbortV9WithoutCreatingRegistry() {
        jdbc.update("INSERT INTO business_cards (user_id, image_url) VALUES (?, '/uploads/shared.jpg')", owner);
        jdbc.update("INSERT INTO posters (user_id, doc_type, parsed_json) VALUES (?, 'POSTER', ?::jsonb)", other,
                "{\"image_url\":\"https://legacy.example/uploads/shared.jpg\"}");
        assertThrows(RuntimeException.class, () -> migrate("9"));
        assertNull(jdbc.queryForObject("SELECT to_regclass(?)::text", String.class, schema + ".stored_images"));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM business_cards", Integer.class));
    }

    @Test
    void unsupportedLegacyShapeAbortsRatherThanSilentlyLosingReferences() {
        jdbc.update("INSERT INTO posters (user_id, doc_type, parsed_json) VALUES (?, 'POSTER', '42')", owner);
        assertThrows(RuntimeException.class, () -> migrate("9"));
        assertNull(jdbc.queryForObject("SELECT to_regclass(?)::text", String.class, schema + ".stored_images"));
    }

    @Test
    void replacementAndSharedCrossTypeReferencesUseRealPreparedReferenceQuery() {
        migrate("9"); startService();
        transaction.executeWithoutResult(status -> {
            service.registerUpload(owner, "/uploads/old.jpg");
            service.registerUpload(owner, "/uploads/new.jpg");
        });
        jdbc.update("INSERT INTO business_cards (user_id, image_url) VALUES (?, '/uploads/old.jpg')", owner);
        jdbc.update("INSERT INTO posters (user_id, doc_type, parsed_json, raw_json) VALUES (?, 'POSTER', ?::jsonb, '[]')",
                owner, "{\"nested\":[{\"image_url\":\"https://legacy.example/uploads/old.jpg\"}]}");
        transaction.executeWithoutResult(status -> {
            service.lockOwner(owner);
            String canonical = service.normalizeOwnedReference(owner, "https://legacy.example/uploads/new.jpg");
            jdbc.update("UPDATE business_cards SET image_url = ? WHERE user_id = ?", canonical, owner);
            service.deleteIfUnreferenced(owner, "/uploads/old.jpg");
        });
        verifyNoInteractions(ocr);
        transaction.executeWithoutResult(status -> {
            service.lockOwner(owner);
            jdbc.update("DELETE FROM posters WHERE user_id = ?", owner);
            service.deleteIfUnreferenced(owner, "/uploads/old.jpg");
        });
        verify(ocr).deleteImage("old.jpg");
        assertEquals(List.of("new.jpg"), jdbc.queryForList("SELECT image_name FROM stored_images", String.class));
    }

    @Test
    void realDocumentServicesFlushJpaChangesAndPreserveSharedImagesAcrossAllFourTypes() {
        migrate("9"); startService();
        EmbeddingService embedding = mock(EmbeddingService.class);
        CardService cards = new CardService(repositories.getRepository(BusinessCardRepository.class),
                repositories.getRepository(CardGroupRepository.class), embedding, service);
        PosterService posters = new PosterService(repositories.getRepository(PosterRepository.class), embedding, service);
        TicketService tickets = new TicketService(repositories.getRepository(TicketRepository.class), embedding, service);
        ReceiptService receipts = new ReceiptService(repositories.getRepository(ReceiptRepository.class), embedding, service);
        transaction.executeWithoutResult(status -> {
            service.registerUpload(owner, "/uploads/shared.jpg");
            service.registerUpload(owner, "/uploads/replacement.jpg");
        });
        CardSaveRequest card = new CardSaveRequest();
        card.setImageUrl("https://legacy.example/uploads/shared.jpg");
        PosterRequest poster = new PosterRequest();
        poster.setDocType("POSTER"); poster.setParsedJson("{\"imageUrl\":\"/uploads/shared.jpg\"}");
        TicketRequest ticket = new TicketRequest();
        ticket.setDocType("TICKET"); ticket.setRawJson("[{\"image_url\":\"/uploads/shared.jpg\"}]");
        ReceiptSaveRequest receipt = new ReceiptSaveRequest();
        receipt.setParsedJson("{\"image_url\":\"/uploads/shared.jpg\"}");
        assertThrows(ResponseStatusException.class, () -> transaction.execute(status -> cards.save(other, card)));
        assertThrows(ResponseStatusException.class, () -> transaction.execute(status -> posters.save(other, poster)));
        assertThrows(ResponseStatusException.class, () -> transaction.execute(status -> tickets.save(other, ticket)));
        assertThrows(ResponseStatusException.class, () -> transaction.execute(status -> receipts.save(other, receipt)));
        var savedCard = transaction.execute(status -> cards.save(owner, card));
        var savedPoster = transaction.execute(status -> posters.save(owner, poster));
        var savedTicket = transaction.execute(status -> tickets.save(owner, ticket));
        var savedReceipt = transaction.execute(status -> receipts.save(owner, receipt));
        card.setImageUrl("/uploads/replacement.jpg");
        transaction.executeWithoutResult(status -> cards.update(owner, savedCard.getId(), card));
        transaction.executeWithoutResult(status -> posters.delete(owner, savedPoster.getId()));
        transaction.executeWithoutResult(status -> tickets.delete(owner, savedTicket.getId()));
        verifyNoInteractions(ocr);
        doThrow(new RuntimeException("upstream unavailable")).doNothing().when(ocr).deleteImage("shared.jpg");
        assertThrows(RuntimeException.class, () -> transaction.executeWithoutResult(
                status -> receipts.delete(owner, savedReceipt.getId())));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM receipts", Integer.class));
        transaction.executeWithoutResult(status -> receipts.delete(owner, savedReceipt.getId()));
        verify(ocr, times(2)).deleteImage("shared.jpg");
        transaction.executeWithoutResult(status -> cards.delete(owner, savedCard.getId()));
        verify(ocr).deleteImage("replacement.jpg");
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM stored_images", Integer.class));
    }

    @Test
    void upstreamFailureRollsBackDocumentAndRegistryAndRetrySucceeds() {
        migrate("9"); startService();
        transaction.executeWithoutResult(status -> service.registerUpload(owner, "/uploads/retry.jpg"));
        jdbc.update("INSERT INTO business_cards (user_id, image_url) VALUES (?, '/uploads/retry.jpg')", owner);
        doThrow(new RuntimeException("upstream unavailable")).doNothing().when(ocr).deleteImage("retry.jpg");
        Runnable delete = () -> transaction.executeWithoutResult(status -> {
            service.lockOwner(owner);
            jdbc.update("DELETE FROM business_cards WHERE user_id = ?", owner);
            service.deleteIfUnreferenced(owner, "/uploads/retry.jpg");
        });
        assertThrows(RuntimeException.class, delete::run);
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM business_cards", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM stored_images", Integer.class));
        delete.run();
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM business_cards", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM stored_images", Integer.class));
    }

    @Test
    void bulkFailureRestoresAllRegistryEntriesAndAccountBeforeRetry() {
        migrate("9"); startService();
        transaction.executeWithoutResult(status -> {
            for (String name : List.of("card", "poster", "ticket", "receipt", "pending")) {
                service.registerUpload(owner, "/uploads/" + name + ".jpg");
            }
        });
        doThrow(new RuntimeException("upstream unavailable")).doNothing().when(ocr).deleteImage("receipt.jpg");
        Runnable delete = () -> transaction.executeWithoutResult(status -> {
            service.deleteAll(owner);
            jdbc.update("DELETE FROM users WHERE id = ?", owner);
        });
        assertThrows(RuntimeException.class, delete::run);
        assertEquals(5, jdbc.queryForObject("SELECT count(*) FROM stored_images", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM users WHERE id = ?", Integer.class, owner));
        delete.run();
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM stored_images", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM users WHERE id = ?", Integer.class, owner));
        verify(ocr, times(2)).deleteImage("pending.jpg");
    }

    @Test
    void cleanupOnlyDeletesExpiredUnreferencedImages() {
        migrate("9"); startService();
        transaction.executeWithoutResult(status -> {
            for (String name : List.of("old-pending", "old-attached", "fresh")) {
                service.registerUpload(owner, "/uploads/" + name + ".jpg");
            }
        });
        jdbc.update("UPDATE stored_images SET created_at = now() - interval '25 hours' WHERE image_name LIKE 'old-%'");
        jdbc.update("INSERT INTO tickets (user_id, doc_type, raw_json) VALUES (?, 'TICKET', ?::jsonb)", owner,
                "[{\"imageUrl\":\"/uploads/old-attached.jpg\"}]");
        Instant cutoff = Instant.now().minus(24, ChronoUnit.HOURS);
        assertEquals(List.of(owner), service.findCleanupOwners(cutoff));
        transaction.executeWithoutResult(status -> service.cleanupExpired(owner, cutoff));
        verify(ocr).deleteImage("old-pending.jpg");
        verify(ocr, never()).deleteImage("old-attached.jpg");
        verify(ocr, never()).deleteImage("fresh.jpg");
        assertEquals(List.of("fresh.jpg", "old-attached.jpg"),
                jdbc.queryForList("SELECT image_name FROM stored_images ORDER BY image_name", String.class));
    }

    @Test
    void uploadFinishingAfterAccountDeletionIsCompensatedButConflictingNameIsNot() {
        migrate("9"); startService();
        transaction.executeWithoutResult(status -> service.registerUpload(other, "/uploads/victim.jpg"));
        jdbc.update("DELETE FROM users WHERE id = ?", owner);
        assertThrows(ResponseStatusException.class, () -> transaction.executeWithoutResult(
                status -> service.registerUpload(owner, "/uploads/late.jpg")));
        verify(ocr).deleteImage("late.jpg");
        assertThrows(ResponseStatusException.class, () -> transaction.executeWithoutResult(
                status -> service.registerUpload(owner, "/uploads/victim.jpg")));
        verify(ocr, never()).deleteImage("victim.jpg");
        jdbc.update("INSERT INTO stored_image_deletions (image_name) VALUES ('victim.jpg')");
        assertThrows(IllegalStateException.class, () -> deletions.deleteQueued("victim.jpg"));
        verify(ocr, never()).deleteImage("victim.jpg");
    }

    @Test
    void failedMissingOwnerCompensationPersistsOutboxAcrossOuterRollbackAndRetries() {
        migrate("9"); startService();
        jdbc.update("DELETE FROM users WHERE id = ?", owner);
        doThrow(new RuntimeException("upstream unavailable")).doNothing().when(ocr).deleteImage("late-failed.jpg");
        assertThrows(RuntimeException.class, () -> transaction.executeWithoutResult(
                status -> service.registerUpload(owner, "/uploads/late-failed.jpg")));
        assertEquals(List.of("late-failed.jpg"), deletions.findPending());
        assertThrows(IllegalStateException.class, () -> transaction.executeWithoutResult(
                status -> service.registerUpload(other, "/uploads/late-failed.jpg")));
        deletions.deleteQueued("late-failed.jpg");
        assertTrue(deletions.findPending().isEmpty());
        verify(ocr, times(2)).deleteImage("late-failed.jpg");
    }

    @Test
    void threeConcurrentOrphanCompletionsPersistCompensationWithOnlyThreePoolConnections() throws Exception {
        migrate("9");
        jdbc.update("DELETE FROM users");
        JdbcTemplate registrationJdbc = spy(jdbc);
        CyclicBarrier missingOwners = new CyclicBarrier(3, () ->
                assertEquals(3, dataSource.getHikariPoolMXBean().getActiveConnections()));
        doAnswer(call -> {
            Object result = call.callRealMethod();
            missingOwners.await(5, TimeUnit.SECONDS);
            return result;
        }).when(registrationJdbc).queryForList(eq("SELECT id FROM users WHERE id = ? FOR UPDATE"),
                eq(UUID.class), any(UUID.class));
        startService(registrationJdbc);
        CyclicBarrier deleting = new CyclicBarrier(3);
        doAnswer(call -> {
            deleting.await(5, TimeUnit.SECONDS);
            throw new RuntimeException("storage unavailable");
        }).when(ocr).deleteImage(anyString());
        try (var executor = Executors.newFixedThreadPool(3)) {
            var completions = new ArrayList<java.util.concurrent.Future<?>>();
            for (int i = 0; i < 3; i++) {
                UUID missingOwner = UUID.randomUUID();
                String imageUrl = "/uploads/orphan-" + i + ".jpg";
                completions.add(executor.submit(() -> {
                    RuntimeException failure = assertThrows(RuntimeException.class,
                            () -> service.registerUpload(missingOwner, imageUrl));
                    assertEquals("storage unavailable", failure.getMessage());
                }));
            }
            for (var completion : completions) completion.get(10, TimeUnit.SECONDS);
        }
        assertEquals(List.of("orphan-0.jpg", "orphan-1.jpg", "orphan-2.jpg"), jdbc.queryForList(
                "SELECT image_name FROM stored_image_deletions ORDER BY image_name", String.class));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM stored_images", Integer.class));
        assertEquals(0, dataSource.getHikariPoolMXBean().getThreadsAwaitingConnection());
        assertEquals(0, dataSource.getHikariPoolMXBean().getActiveConnections());
        doNothing().when(ocr).deleteImage(anyString());
        for (String name : deletions.findPending()) deletions.deleteQueued(name);
        assertTrue(deletions.findPending().isEmpty());
    }

    @Test
    void ownerLockSerializesRegistrationBehindAccountDeletion() throws Exception {
        migrate("9"); startService();
        CountDownLatch deletionLocked = new CountDownLatch(1);
        CountDownLatch allowDeletion = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var deletion = executor.submit(() -> transaction.executeWithoutResult(status -> {
                service.lockOwner(owner);
                deletionLocked.countDown();
                try { assertTrue(allowDeletion.await(5, TimeUnit.SECONDS)); }
                catch (InterruptedException e) { throw new RuntimeException(e); }
                service.deleteAll(owner);
                jdbc.update("DELETE FROM users WHERE id = ?", owner);
            }));
            assertTrue(deletionLocked.await(5, TimeUnit.SECONDS));
            var registration = executor.submit(() -> assertThrows(ResponseStatusException.class,
                    () -> transaction.executeWithoutResult(status -> service.registerUpload(owner, "/uploads/racing.jpg"))));
            try {
                Thread.sleep(100);
                assertFalse(registration.isDone());
            } finally { allowDeletion.countDown(); }
            deletion.get(5, TimeUnit.SECONDS);
            registration.get(5, TimeUnit.SECONDS);
            verify(ocr).deleteImage("racing.jpg");
        }
    }

    private void migrate(String version) {
        Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                .target(version).load().migrate();
    }

    private void startService() {
        startService(jdbc);
    }

    private void startService(JdbcTemplate registrationJdbc) {
        LocalContainerEntityManagerFactoryBean factory = new LocalContainerEntityManagerFactoryBean();
        factory.setDataSource(dataSource);
        factory.setPackagesToScan("com.mora.entity");
        factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
        factory.setJpaPropertyMap(Map.of("hibernate.hbm2ddl.auto", "none",
                "hibernate.physical_naming_strategy", "org.hibernate.boot.model.naming.CamelCaseToUnderscoresNamingStrategy"));
        factory.afterPropertiesSet();
        emf = factory.getObject();
        repositories = new JpaRepositoryFactory(SharedEntityManagerCreator.createSharedEntityManager(emf));
        var repository = repositories.getRepository(StoredImageRepository.class);
        var manager = new JpaTransactionManager(emf);
        transaction = new TransactionTemplate(manager);
        deletions = transactional(new StoredImageDeletionService(jdbc, ocr), manager);
        var registration = transactional(new StoredImageRegistrationService(repository, registrationJdbc, deletions), manager);
        service = transactional(new StoredImageService(repository, ocr, jdbc, new ObjectMapper(), deletions, registration), manager);
    }

    @SuppressWarnings("unchecked")
    private <T> T transactional(T target, JpaTransactionManager manager) {
        ProxyFactory proxy = new ProxyFactory(target);
        proxy.addAdvice(new TransactionInterceptor(manager, new AnnotationTransactionAttributeSource()));
        return (T) proxy.getProxy();
    }
}
