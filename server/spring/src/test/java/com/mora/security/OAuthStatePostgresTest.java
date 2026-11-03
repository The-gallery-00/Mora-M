package com.mora.security;

import com.mora.repository.OAuthStateRepository;
import jakarta.servlet.http.Cookie;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

// Opt in with OAUTH_TEST_DATABASE_URL (and optional USER/PASSWORD) against disposable PostgreSQL.
// Each test applies the real V8 migration in its own randomly named schema.
@EnabledIfEnvironmentVariable(named = "OAUTH_TEST_DATABASE_URL", matches = ".+")
class OAuthStatePostgresTest {

    private JdbcTemplate admin;
    private JdbcTemplate jdbc;
    private String schema;
    private AnnotationConfigApplicationContext context;
    private OAuthStateRepository repository;

    @BeforeEach
    void setUp() {
        String url = System.getenv("OAUTH_TEST_DATABASE_URL");
        String user = System.getenv().getOrDefault("OAUTH_TEST_DATABASE_USER", "postgres");
        String password = System.getenv().getOrDefault("OAUTH_TEST_DATABASE_PASSWORD", "oauth-test");
        admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        schema = "oauth_test_" + UUID.randomUUID().toString().replace("-", "");
        admin.execute("CREATE SCHEMA " + schema);
        var dataSource = new DriverManagerDataSource(url, user, password);
        Properties properties = new Properties();
        properties.setProperty("currentSchema", schema);
        dataSource.setConnectionProperties(properties);
        var flyway = Flyway.configure().dataSource(dataSource).defaultSchema(schema)
                .locations("classpath:db/migration").baselineVersion("7").target("8").load();
        flyway.baseline();
        assertEquals(1, flyway.migrate().migrationsExecuted);
        flyway.validate();
        jdbc = new JdbcTemplate(dataSource);
        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(JdbcTemplate.class, () -> jdbc);
        context.registerBean(OAuthStateRepository.class);
        context.register(Transactions.class);
        context.refresh();
        repository = context.getBean(OAuthStateRepository.class);
    }

    @AfterEach
    void tearDown() {
        if (context != null) context.close();
        if (admin != null && schema != null) admin.execute("DROP SCHEMA " + schema + " CASCADE");
    }

    @ParameterizedTest
    @EnumSource(OAuthStateService.Provider.class)
    void rejectsMismatchWrongProviderExpiryAndReplay(OAuthStateService.Provider provider) {
        String stateHash = "a".repeat(64);
        String browserHash = "b".repeat(64);
        repository.create(stateHash, browserHash, provider.value());
        var row = jdbc.queryForMap("SELECT * FROM oauth_login_states");
        assertEquals(stateHash, row.get("state_hash"));
        assertEquals(browserHash, row.get("browser_hash"));
        assertTrue(jdbc.queryForObject("""
                SELECT expires_at > CURRENT_TIMESTAMP + INTERVAL '9 minutes'
                   AND expires_at <= CURRENT_TIMESTAMP + INTERVAL '10 minutes'
                FROM oauth_login_states
                """, Boolean.class));
        assertFalse(repository.consume("c".repeat(64), browserHash, provider.value()));
        assertFalse(repository.consume(stateHash, "c".repeat(64), provider.value()));
        String wrongProvider = provider == OAuthStateService.Provider.GOOGLE ? "naver" : "google";
        assertFalse(repository.consume(stateHash, browserHash, wrongProvider));
        assertTrue(repository.consume(stateHash, browserHash, provider.value()));
        assertFalse(repository.consume(stateHash, browserHash, provider.value()));

        repository.create(stateHash, browserHash, provider.value());
        jdbc.update("UPDATE oauth_login_states SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'");
        assertFalse(repository.consume(stateHash, browserHash, provider.value()));
        repository.create("c".repeat(64), browserHash, provider.value());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM oauth_login_states", Integer.class));
    }

    @Test
    void separateServiceInstancesShareStateAndOnlyOneConcurrentCallbackWins() throws Exception {
        var firstReplica = new OAuthStateService(repository);
        var secondReplica = new OAuthStateService(repository);
        var provider = OAuthStateService.Provider.GOOGLE;
        var issued = firstReplica.issue(provider);
        int workers = 12;
        var ready = new CountDownLatch(workers);
        var start = new CountDownLatch(1);
        List<Future<Boolean>> results = new ArrayList<>();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < workers; i++) {
                var replica = i % 2 == 0 ? firstReplica : secondReplica;
                results.add(executor.submit(() -> {
                    var request = new MockHttpServletRequest();
                    request.setCookies(new Cookie(provider.cookieName(), issued.cookie().getValue()));
                    ready.countDown();
                    assertTrue(start.await(10, TimeUnit.SECONDS));
                    try {
                        replica.verifyAndConsume(provider, issued.state(), request);
                        return true;
                    } catch (IllegalArgumentException invalidState) {
                        return false;
                    }
                }));
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS));
            start.countDown();
            int winners = 0;
            for (Future<Boolean> result : results) {
                if (result.get(15, TimeUnit.SECONDS)) winners++;
            }
            assertEquals(1, winners);
        }
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM oauth_login_states", Integer.class));
    }

    @Test
    void consumptionStaysCommittedEvenIfLaterLoginTransactionRollsBack() {
        repository.create("a".repeat(64), "b".repeat(64), "kakao");
        var transaction = new TransactionTemplate(context.getBean(PlatformTransactionManager.class));
        transaction.executeWithoutResult(status -> {
            assertTrue(repository.consume("a".repeat(64), "b".repeat(64), "kakao"));
            status.setRollbackOnly();
        });
        assertFalse(repository.consume("a".repeat(64), "b".repeat(64), "kakao"));
    }

    @TestConfiguration(proxyBeanMethods = false)
    @EnableTransactionManagement(proxyTargetClass = true)
    static class Transactions {
        @Bean
        PlatformTransactionManager transactionManager(DataSource dataSource) {
            return new DataSourceTransactionManager(dataSource);
        }
    }
}
