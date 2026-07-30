package com.mora.repository;

import com.mora.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * ═══════════════════════════════════════════════════════════════
 * UserRepository — 사용자(User) 데이터 접근 리포지토리
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * User 엔티티에 대한 CRUD 및 커스텀 조회 메서드를 제공하는
 * Spring Data JPA 리포지토리 인터페이스이다.
 * AuthService에서 회원가입 시 이메일 중복 확인, 로그인 시 이메일로
 * 사용자 조회, 사용자 ID로 조회 등에 사용된다.
 *
 * [코드 흐름]
 * 1) AuthService가 이 리포지토리를 주입받아 사용한다.
 * 2) 회원가입: existsByEmail()로 중복 확인 → save()로 저장.
 * 3) 로그인: findByEmail()로 사용자 조회.
 * 4) 내 정보: findById()로 사용자 조회 (JpaRepository 기본 제공 메서드).
 *
 * [메서드 목록]
 * - findByEmail(String email): 이메일로 사용자를 조회한다. Optional 반환.
 * - existsByEmail(String email): 해당 이메일의 사용자가 존재하는지 확인한다.
 * - (상속) save(), findById(), deleteById() 등: JpaRepository가 기본 제공하는 CRUD 메서드.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Repository
 *   — 이 인터페이스가 데이터 접근 계층(DAO)임을 표시한다.
 *     Spring이 JPA 구현체(프록시)를 자동 생성하여 빈으로 등록한다.
 *
 * JpaRepository<User, UUID>
 *   — Spring Data JPA가 제공하는 인터페이스.
 *     User 엔티티, UUID 타입 기본 키에 대해
 *     save(), findById(), findAll(), delete() 등 표준 CRUD 메서드를 자동 제공한다.
 *
 * Spring Data JPA 쿼리 메서드 규칙
 *   — findByEmail → "SELECT * FROM users WHERE email = ?" 쿼리 자동 생성
 *   — existsByEmail → "SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)" 쿼리 자동 생성
 *     메서드 이름의 접두사(findBy, existsBy)와 필드명(Email)을 분석하여
 *     SQL을 자동으로 만들어 준다.
 * ───────────────────────────────────────────
 */
@Repository
public interface UserRepository extends JpaRepository<User, UUID> {

    /** 이메일 주소로 사용자를 조회한다. 존재하지 않으면 Optional.empty() 반환. */
    Optional<User> findByEmail(String email);

    /** 해당 이메일로 가입된 사용자가 있는지 확인한다 (회원가입 시 중복 검사용). */
    boolean existsByEmail(String email);
}
