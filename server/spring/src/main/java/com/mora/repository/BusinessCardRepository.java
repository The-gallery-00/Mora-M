package com.mora.repository;

import com.mora.entity.BusinessCard;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * ═══════════════════════════════════════════════════════════════
 * BusinessCardRepository — 명함(BusinessCard) 데이터 접근 리포지토리
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * BusinessCard 엔티티에 대한 CRUD 및 벡터 유사도 검색을 제공하는
 * Spring Data JPA 리포지토리 인터페이스이다.
 * CardService에서 명함 저장, 목록 조회, 수정, 삭제, 유사도 검색에 사용된다.
 *
 * [코드 흐름]
 * 1) CardService가 이 리포지토리를 주입받아 사용한다.
 * 2) 명함 저장: save()로 INSERT/UPDATE.
 * 3) 목록 조회: findByUserIdOrderByCreatedAtDesc()로 사용자별 최신순 조회.
 * 4) 삭제: delete()로 엔티티 삭제.
 * 5) 벡터 검색: searchByVector()로 pgvector 코사인 유사도 기반 검색.
 *
 * [메서드 목록]
 * - findByUserIdOrderByCreatedAtDesc(UUID userId):
 *   특정 사용자의 명함을 생성일 내림차순으로 조회한다.
 * - searchByVector(UUID userId, String vec, int topK):
 *   pgvector의 코사인 거리 연산자(<=>)로 유사도 검색을 수행한다.
 * - (상속) save(), findById(), delete() 등: JpaRepository 기본 CRUD.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Repository
 *   — 데이터 접근 계층 표시. JPA 프록시가 자동 생성된다.
 *
 * JpaRepository<BusinessCard, UUID>
 *   — 표준 CRUD 메서드를 자동 제공한다.
 *
 * @Query(nativeQuery = true)
 *   — JPQL 대신 네이티브 SQL을 직접 작성한다.
 *     pgvector 확장의 <=> (코사인 거리) 연산자를 사용하기 위해 필요하다.
 *
 * @Param("name")
 *   — 네이티브 쿼리의 :name 바인드 변수에 메서드 파라미터를 매핑한다.
 *
 * [pgvector 관련]
 * ───────────────────────────────────────────
 * embedding <=> CAST(:vec AS vector)
 *   — <=> 는 pgvector의 코사인 거리 연산자이다.
 *     결과값이 작을수록 유사도가 높다.
 *
 * 1 - (embedding <=> CAST(:vec AS vector)) AS similarity
 *   — 코사인 거리를 코사인 유사도(0~1)로 변환한다.
 *     1이면 완전히 동일, 0이면 완전히 다름.
 * ───────────────────────────────────────────
 */
@Repository
public interface BusinessCardRepository extends JpaRepository<BusinessCard, UUID> {

    /** 특정 사용자의 명함 목록을 생성일 내림차순(최신순)으로 조회한다. */
    List<BusinessCard> findByUserIdOrderByCreatedAtDesc(UUID userId);

    /**
     * pgvector 코사인 유사도 기반으로 명함을 검색한다.
     * 임베딩이 있는 명함 중 주어진 벡터와 가장 유사한 topK개를 반환한다.
     *
     * @param userId 검색 대상 사용자 ID
     * @param vec    검색 쿼리의 임베딩 벡터 문자열 (예: "[0.1, 0.2, ...]")
     * @param topK   반환할 최대 결과 수
     * @return 명함 데이터 + similarity 점수를 포함한 Map 리스트
     */
    @Query(value = """
            SELECT *, 1 - (embedding <=> CAST(:vec AS vector)) AS similarity
            FROM business_cards
            WHERE user_id = :userId AND embedding IS NOT NULL
            ORDER BY embedding <=> CAST(:vec AS vector)
            LIMIT :topK
            """, nativeQuery = true)
    List<Map<String, Object>> searchByVector(
            @Param("userId") UUID userId,
            @Param("vec") String vec,
            @Param("topK") int topK
    );
}
