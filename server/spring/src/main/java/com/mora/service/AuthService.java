package com.mora.service;

import com.mora.dto.AuthResponse;
import com.mora.dto.LoginRequest;
import com.mora.dto.SignupRequest;
import com.mora.entity.User;
import com.mora.repository.UserRepository;
import com.mora.security.JwtUtil;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * ═══════════════════════════════════════════════════════════════
 * AuthService — 인증(Authentication) 비즈니스 로직 서비스
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 회원가입, 로그인, 사용자 조회 등 인증 관련 비즈니스 로직을 처리한다.
 * AuthController에서 호출되며, UserRepository를 통해 DB에 접근하고,
 * PasswordEncoder로 비밀번호를 해싱/검증하고,
 * JwtUtil로 JWT 토큰을 발급한다.
 *
 * [코드 흐름]
 * 1) 회원가입 (signup):
 *    → 이메일 중복 확인 → User 엔티티 생성 → 비밀번호 BCrypt 해싱
 *    → DB 저장 → JWT 토큰 생성 → AuthResponse 반환
 * 2) 로그인 (login):
 *    → 이메일로 사용자 조회 → 비밀번호 BCrypt 검증
 *    → JWT 토큰 생성 → AuthResponse 반환
 * 3) 사용자 조회 (getUserById):
 *    → UUID로 사용자 조회 → User 엔티티 반환
 *
 * [메서드 목록]
 * - signup(SignupRequest): 회원가입 처리. 이메일 중복 확인 후 사용자를 생성하고 JWT를 발급한다.
 * - login(LoginRequest): 로그인 처리. 이메일/비밀번호 검증 후 JWT를 발급한다.
 * - getUserById(UUID): 사용자 ID로 User 엔티티를 조회한다.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Service
 *   — 이 클래스가 서비스 계층의 빈임을 선언한다.
 *     Spring이 자동으로 빈으로 등록하여 다른 클래스에서 주입 가능하게 한다.
 *
 * PasswordEncoder (Spring Security)
 *   — encode(rawPassword): 평문 비밀번호를 BCrypt로 해싱한다.
 *   — matches(rawPassword, encodedPassword): 평문과 해시 값을 비교·검증한다.
 *
 * JwtUtil
 *   — generateToken(userId, email): 사용자 정보를 담은 JWT 토큰을 생성한다.
 *
 * UserRepository
 *   — existsByEmail(): 이메일 중복 확인.
 *   — save(): User 엔티티를 DB에 저장(INSERT).
 *   — findByEmail(): 이메일로 사용자 조회.
 *   — findById(): UUID로 사용자 조회.
 * ───────────────────────────────────────────
 */
@Service
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder, JwtUtil jwtUtil) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtil = jwtUtil;
    }

    /**
     * 회원가입을 처리한다.
     * 이메일 중복 시 RuntimeException을 던진다.
     */
    public AuthResponse signup(SignupRequest request) {
        // 이메일 중복 확인
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new RuntimeException("Email already exists");
        }

        // User 엔티티 생성 및 필드 설정
        User user = new User();
        user.setProvider("local");  // 직접 가입 = "local" 제공자
        user.setEmail(request.getEmail());
        user.setPasswordHash(passwordEncoder.encode(request.getPassword()));  // BCrypt 해싱
        user.setName(request.getName());

        // DB에 저장 (JPA가 UUID 자동 생성, @PrePersist로 createdAt 설정)
        user = userRepository.save(user);
        // JWT 토큰 생성
        String token = jwtUtil.generateToken(user.getId(), user.getEmail());

        return new AuthResponse(token, user.getId(), user.getEmail(), user.getName());
    }

    /**
     * 로그인을 처리한다.
     * 이메일이 없거나 비밀번호가 불일치하면 RuntimeException을 던진다.
     */
    public AuthResponse login(LoginRequest request) {
        // 이메일로 사용자 조회 (없으면 예외)
        User user = userRepository.findByEmail(request.getEmail())
                .orElseThrow(() -> new RuntimeException("Invalid email or password"));

        // 입력된 평문 비밀번호와 저장된 BCrypt 해시를 비교
        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            throw new RuntimeException("Invalid email or password");
        }

        // JWT 토큰 생성
        String token = jwtUtil.generateToken(user.getId(), user.getEmail());

        return new AuthResponse(token, user.getId(), user.getEmail(), user.getName());
    }

    /**
     * 사용자 ID(UUID)로 User 엔티티를 조회한다.
     * 존재하지 않으면 RuntimeException을 던진다.
     */
    public User getUserById(UUID userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));
    }
}
