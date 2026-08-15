package com.mora.service;

import com.mora.dto.AuthResponse;
import com.mora.dto.LoginRequest;
import com.mora.dto.OAuthProfile;
import com.mora.dto.SignupRequest;
import com.mora.entity.BusinessCard;
import com.mora.entity.User;
import com.mora.repository.BusinessCardRepository;
import com.mora.repository.UserRepository;
import com.mora.security.JwtUtil;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

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
    private final BusinessCardRepository businessCardRepository;
    private final OcrService ocrService;

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder, JwtUtil jwtUtil,
                        BusinessCardRepository businessCardRepository, OcrService ocrService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtil = jwtUtil;
        this.businessCardRepository = businessCardRepository;
        this.ocrService = ocrService;
    }

    /**
     * 회원가입을 처리한다.
     * 이메일 중복 시 RuntimeException을 던진다.
     */
    public AuthResponse signup(SignupRequest request) {
        String email = normalizeEmail(request.getEmail());

        // 이메일 중복 확인
        if (userRepository.existsByEmail(email)) {
            throw new RuntimeException("Email already exists");
        }

        // User 엔티티 생성 및 필드 설정
        User user = new User();
        user.setProvider("local");  // 직접 가입 = "local" 제공자
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(request.getPassword()));  // BCrypt 해싱
        user.setName(normalizeName(request.getName(), email));

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
        User user = userRepository.findByEmailAndProvider(normalizeEmail(request.getEmail()), "local")
                .orElseThrow(() -> new RuntimeException("Invalid email or password"));

        // 입력된 평문 비밀번호와 저장된 BCrypt 해시를 비교
        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            throw new RuntimeException("Invalid email or password");
        }

        // JWT 토큰 생성
        String token = jwtUtil.generateToken(user.getId(), user.getEmail());

        return new AuthResponse(token, user.getId(), user.getEmail(), user.getName());
    }

    @Transactional
    public AuthResponse loginWithOAuth(OAuthProfile profile) {
        String provider = normalizeProvider(profile.provider());
        String email = normalizeEmail(profile.email());
        String name = normalizeName(profile.name(), email);
        String picture = profile.picture() == null ? "" : profile.picture().trim();

        User user = userRepository.findByEmailAndProvider(email, provider)
                .orElseGet(() -> {
                    User created = new User();
                    created.setProvider(provider);
                    created.setEmail(email);
                    created.setPasswordHash(null);
                    created.setName(name);
                    created.setPicture(picture);
                    return userRepository.save(created);
                });

        boolean changed = false;
        if (user.getName() == null || user.getName().isBlank()) {
            user.setName(name);
            changed = true;
        }
        if (picture != null && !picture.isBlank() && !picture.equals(user.getPicture())) {
            user.setPicture(picture);
            changed = true;
        }
        if (changed) {
            user = userRepository.save(user);
        }

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

    // 계정을 삭제한다. 명함 이미지(GCS)를 먼저 지우고 유저 row를 삭제한다 (business_cards는 CASCADE로 자동 삭제)
    @Transactional
    public void deleteAccount(UUID userId) {
        User user = getUserById(userId);

        // GCS 이미지를 DB보다 먼저 지운다 — 실패하면 유저 row가 남아있어 재시도 가능
        List<BusinessCard> cards = businessCardRepository.findByUserId(userId);
        for (BusinessCard card : cards) {
            String imageUrl = card.getImageUrl();
            if (imageUrl != null && imageUrl.startsWith("/uploads/")) {
                ocrService.deleteImage(imageUrl.substring("/uploads/".length()));
            }
        }

        userRepository.delete(user);
    }

    private static final Pattern NAME_PATTERN = Pattern.compile("^[a-zA-Z0-9가-힣_.\\-]+$");

    // API-04. 프론트 nicknameSchema와 동일 규칙으로 서버도 재검증함
    public User changeName(UUID userId, String name) {
        User user = getUserById(userId);
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.length() < 2 || trimmed.length() > 20 || !NAME_PATTERN.matcher(trimmed).matches()) {
            throw new RuntimeException("Invalid nickname");
        }
        user.setName(trimmed);
        return userRepository.save(user);
    }

    // API-05. 소셜 계정은 비밀번호가 없어서 차단함
    @Transactional
    public void changePassword(UUID userId, String currentPassword, String newPassword) {
        User user = getUserById(userId);
        if (!"local".equals(user.getProvider())) {
            throw new RuntimeException("Social account cannot change password");
        }
        if (currentPassword == null || currentPassword.isBlank()
                || !passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            throw new RuntimeException("Current password mismatch");
        }
        if (newPassword == null || newPassword.length() < 8) {
            throw new RuntimeException("New password too short");
        }
        if (passwordEncoder.matches(newPassword, user.getPasswordHash())) {
            throw new RuntimeException("New password must differ from current");
        }
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(user);
    }

    private String normalizeEmail(String email) {
        if (email == null) {
            throw new RuntimeException("Email is required");
        }
        String normalized = email.trim().toLowerCase();
        if (normalized.isBlank()) {
            throw new RuntimeException("Email is required");
        }
        return normalized;
    }

    private String normalizeProvider(String provider) {
        if (provider == null) {
            throw new RuntimeException("Provider is required");
        }
        String normalized = provider.trim().toLowerCase();
        if (!normalized.equals("google") && !normalized.equals("kakao") && !normalized.equals("naver")) {
            throw new RuntimeException("Unsupported provider");
        }
        return normalized;
    }

    private String normalizeName(String name, String email) {
        if (name != null && !name.trim().isBlank()) {
            return name.trim();
        }

        String localPart = email.split("@", 2)[0].trim();
        return localPart.isBlank() ? "사용자" : localPart;
    }
}
