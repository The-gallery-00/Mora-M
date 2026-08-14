package com.mora.repository;

import com.mora.entity.BusinessCard;
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

@Repository
public interface BusinessCardRepository extends JpaRepository<BusinessCard, UUID> {

    long countByUserId(UUID userId);

    Page<BusinessCard> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    // 계정 삭제 시 전체 명함을 순회하기 위한 비페이지네이션 조회
    List<BusinessCard> findByUserId(UUID userId);

    Optional<BusinessCard> findByIdAndUserId(UUID id, UUID userId);

    Page<BusinessCard> findByUserIdAndGroupIdOrderByCreatedAtDesc(UUID userId, UUID groupId, Pageable pageable);

    Page<BusinessCard> findByUserIdAndGroupIdIsNullOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    // API-62 전체 삭제에서 씀
    long deleteByUserId(UUID userId);

    // 필드별 pg_trgm 유사도 검색, GREATEST로 최고 점수만 채택
    @Query(value = """
            SELECT bc.*,
                GREATEST(
                    COALESCE(similarity(bc.name, :query), 0),
                    COALESCE(similarity(bc.company, :query), 0),
                    COALESCE(similarity(bc.position, :query), 0),
                    COALESCE(similarity(bc.phone, :query), 0),
                    COALESCE(similarity(bc.email, :query), 0),
                    COALESCE(word_similarity(:query, bc.raw_ocr_text), 0)
                ) AS fuzzy_score
            FROM business_cards bc
            WHERE bc.user_id = :userId
              AND (
                  similarity(bc.name, :query) >= :threshold
                  OR similarity(bc.company, :query) >= :threshold
                  OR similarity(bc.position, :query) >= :threshold
                  OR similarity(bc.phone, :query) >= :threshold
                  OR similarity(bc.email, :query) >= :threshold
                  OR word_similarity(:query, bc.raw_ocr_text) >= :threshold
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
            FROM business_cards
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
