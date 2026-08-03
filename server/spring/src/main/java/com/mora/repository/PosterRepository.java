package com.mora.repository;

import com.mora.entity.Poster;
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
public interface PosterRepository extends JpaRepository<Poster, Integer> {

    long countByUserId(UUID userId);
    List<Poster> findByUserIdAndEventStartDateBetweenOrderByEventStartDateAsc(
            UUID userId, LocalDate start, LocalDate end);
    List<Poster> findByUserIdAndEventStartDateOrderByCreatedAtAsc(UUID userId, LocalDate date);

    Page<Poster> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    Optional<Poster> findByIdAndUserId(Integer id, UUID userId);

    @Query(value = """
            SELECT p.*,
                GREATEST(
                    COALESCE(similarity(p.title, :query), 0),
                    COALESCE(similarity(p.organizer_name, :query), 0),
                    COALESCE(similarity(p.location, :query), 0),
                    COALESCE(similarity(p.contact_phone, :query), 0),
                    COALESCE(similarity(p.contact_email, :query), 0),
                    COALESCE(word_similarity(:query, p.raw_text), 0)
                ) AS fuzzy_score
            FROM posters p
            WHERE p.user_id = :userId
              AND (
                  similarity(p.title, :query) >= :threshold
                  OR similarity(p.organizer_name, :query) >= :threshold
                  OR similarity(p.location, :query) >= :threshold
                  OR similarity(p.contact_phone, :query) >= :threshold
                  OR similarity(p.contact_email, :query) >= :threshold
                  OR word_similarity(:query, p.raw_text) >= :threshold
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
            FROM posters
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
