package com.mora.repository;

import com.mora.entity.Receipt;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ReceiptRepository extends JpaRepository<Receipt, Integer> {

    long countByUserId(UUID userId);

    @EntityGraph(attributePaths = "items")
    Page<Receipt> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    @EntityGraph(attributePaths = "items")
    Optional<Receipt> findByIdAndUserId(Integer id, UUID userId);

    @Query(value = """
            SELECT r.*,
                GREATEST(
                    COALESCE(similarity(r.merchant_name, :query), 0),
                    COALESCE(similarity(r.merchant_address, :query), 0),
                    COALESCE(similarity(r.payment_method, :query), 0),
                    COALESCE(similarity(r.card_company, :query), 0),
                    COALESCE(word_similarity(:query, r.raw_text), 0)
                ) AS fuzzy_score
            FROM receipts r
            WHERE r.user_id = :userId
              AND (
                  similarity(r.merchant_name, :query) >= :threshold
                  OR similarity(r.merchant_address, :query) >= :threshold
                  OR similarity(r.payment_method, :query) >= :threshold
                  OR similarity(r.card_company, :query) >= :threshold
                  OR word_similarity(:query, r.raw_text) >= :threshold
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
            FROM receipts
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
