package com.mora.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

/**
 * ═══════════════════════════════════════════════════════════════
 * JwtUtil — JWT(JSON Web Token) 생성 및 검증 유틸리티
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * JWT 토큰의 생성, 파싱, 유효성 검증, 사용자 ID 추출 등을 담당한다.
 * AuthService에서 로그인/회원가입 시 토큰을 발급하고,
 * JwtFilter에서 매 요청마다 토큰을 검증할 때 이 클래스를 사용한다.
 *
 * [코드 흐름]
 * 1) 생성자에서 application.yml의 jwt-secret과 jwt-expiration 값을 주입받는다.
 * 2) secret 문자열을 32바이트(256bit)로 맞추어 HMAC-SHA256 키를 생성한다.
 * 3) generateToken(): userId와 email을 클레임에 담아 JWT를 생성한다.
 * 4) parseToken(): 토큰을 파싱하여 Claims(클레임 맵) 객체를 반환한다.
 * 5) getUserId(): 토큰에서 사용자 UUID를 추출한다.
 * 6) isValid(): 토큰이 유효한지(서명, 만료 등) 확인한다.
 *
 * [메서드 목록]
 * - generateToken(UUID userId, String email): JWT 토큰 문자열을 생성·반환한다.
 * - parseToken(String token): 토큰을 파싱하여 Claims 객체를 반환한다.
 * - getUserId(String token): 토큰에서 사용자 UUID를 추출한다.
 * - isValid(String token): 토큰의 유효성을 검사한다 (true/false).
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Component
 *   — Spring이 이 클래스를 빈으로 자동 등록한다. 다른 클래스에서 주입받아 사용 가능.
 *
 * @Value("${app.jwt-secret}")
 *   — application.yml의 app.jwt-secret 값을 생성자 파라미터에 주입한다.
 *
 * @Value("${app.jwt-expiration}")
 *   — application.yml의 app.jwt-expiration 값(밀리초)을 주입한다.
 *
 * [jjwt 라이브러리 (io.jsonwebtoken)]
 * ───────────────────────────────────────────
 * Keys.hmacShaKeyFor(byte[])
 *   — 바이트 배열로부터 HMAC-SHA용 SecretKey를 생성한다.
 *     HS256은 최소 32바이트(256bit) 키를 요구한다.
 *
 * Jwts.builder()
 *   — JWT 토큰을 생성하는 빌더. subject, claim, issuedAt, expiration,
 *     signWith 등을 설정하고 compact()로 최종 토큰 문자열을 만든다.
 *
 * Jwts.parser().verifyWith(key).build()
 *   — JWT 파서를 생성하고 서명 검증 키를 설정한다.
 *
 * parseSignedClaims(token).getPayload()
 *   — 서명된 JWT를 파싱하여 클레임(Payload) 부분을 추출한다.
 *     서명이 잘못되거나 토큰이 만료되면 예외가 발생한다.
 *
 * Claims
 *   — JWT의 Payload 부분을 나타내는 Map 형태의 객체.
 *     getSubject(), get("key", Class) 등으로 클레임 값을 읽는다.
 * ───────────────────────────────────────────
 */
@Component
public class JwtUtil {

    private final SecretKey key;
    private final long expiration;

    public JwtUtil(
            @Value("${app.jwt-secret}") String secret,
            @Value("${app.jwt-expiration}") long expiration) {
        // 키를 최소 32바이트(256bit)로 보장 — HS256 요구사항
        byte[] keyBytes = new byte[32];
        byte[] secretBytes = secret.getBytes(StandardCharsets.UTF_8);
        System.arraycopy(secretBytes, 0, keyBytes, 0, Math.min(secretBytes.length, 32));
        this.key = Keys.hmacShaKeyFor(keyBytes);
        this.expiration = expiration;
    }

    /**
     * JWT 토큰을 생성한다.
     * subject에 userId, 커스텀 클레임에 email과 user_id를 담는다.
     */
    public String generateToken(UUID userId, String email) {
        return Jwts.builder()
                .subject(userId.toString())           // sub 클레임: 사용자 식별자
                .claim("email", email)                // 이메일 커스텀 클레임
                .claim("user_id", userId.toString())  // user_id 커스텀 클레임 (명시적)
                .issuedAt(new Date())                 // 토큰 발급 시각
                .expiration(new Date(System.currentTimeMillis() + expiration))  // 만료 시각
                .signWith(key)                        // HMAC-SHA256 서명
                .compact();                           // 최종 JWT 문자열 생성
    }

    /**
     * JWT 토큰을 파싱하여 Claims(클레임 맵)를 반환한다.
     * 서명 검증 실패 또는 만료 시 예외가 발생한다.
     */
    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(key)            // 서명 검증에 사용할 키 설정
                .build()
                .parseSignedClaims(token)   // 토큰 파싱 및 서명 검증
                .getPayload();              // Payload(Claims) 추출
    }

    /**
     * 토큰에서 사용자 UUID를 추출한다.
     * user_id 클레임을 우선 확인하고, 없으면 subject(sub)에서 가져온다.
     */
    public UUID getUserId(String token) {
        Claims claims = parseToken(token);
        // user_id claim에서 먼저 시도, 없으면 subject
        String uid = claims.get("user_id", String.class);
        if (uid == null) uid = claims.getSubject();
        return UUID.fromString(uid);
    }

    /**
     * 토큰의 유효성을 검사한다.
     * 파싱에 성공하면 true, 서명 불일치·만료 등 예외 발생 시 false를 반환한다.
     */
    public boolean isValid(String token) {
        try {
            parseToken(token);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
