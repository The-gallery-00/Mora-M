package com.mora.repository;

import com.mora.entity.Ticket;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.time.LocalDate;

@Repository
public interface TicketRepository extends JpaRepository<Ticket, Integer> {

    long countByUserId(UUID userId);
    List<Ticket> findByUserIdAndDepartureDateBetweenOrderByDepartureDateAscDepartureTimeAsc(
            UUID userId, LocalDate start, LocalDate end);
    List<Ticket> findByUserIdAndDepartureDateOrderByDepartureTimeAsc(UUID userId, LocalDate date);

    Page<Ticket> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    Optional<Ticket> findByIdAndUserId(Integer id, UUID userId);

    @Query(value = """
            SELECT t.*,
                GREATEST(
                    COALESCE(similarity(t.departure_location, :query), 0),
                    COALESCE(similarity(t.arrival_location, :query), 0),
                    COALESCE(similarity(t.transport_type, :query), 0),
                    COALESCE(word_similarity(:query, t.raw_text), 0)
                ) AS fuzzy_score
            FROM tickets t
            WHERE t.user_id = :userId
              AND (
                  similarity(t.departure_location, :query) >= :threshold
                  OR similarity(t.arrival_location, :query) >= :threshold
                  OR similarity(t.transport_type, :query) >= :threshold
                  OR word_similarity(:query, t.raw_text) >= :threshold
              )
            ORDER BY fuzzy_score DESC
            LIMIT :topK
            """, nativeQuery = true)
    List<Map<String, Object>> fuzzySearch(
            @Param("userId") UUID userId,
            @Param("query") String query,
            @Param("threshold") double threshold,
            @Param("topK") int topK
    );

    @Query(value = """
            SELECT *, 1 - (embedding <=> CAST(:vec AS vector)) AS vector_score
            FROM tickets
            WHERE user_id = :userId AND embedding IS NOT NULL
            ORDER BY embedding <=> CAST(:vec AS vector)
            LIMIT :topK
            """, nativeQuery = true)
    List<Map<String, Object>> vectorSearch(
            @Param("userId") UUID userId,
            @Param("vec") String vec,
            @Param("topK") int topK
    );
}
