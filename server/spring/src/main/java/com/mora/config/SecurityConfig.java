package com.mora.config;

import com.mora.security.JwtFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;

import java.util.List;

/**
 * ═══════════════════════════════════════════════════════════════
 * SecurityConfig — Spring Security 보안 설정
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * Spring Security의 필터 체인, 세션 정책, CORS, CSRF, 인증/인가 규칙,
 * 그리고 비밀번호 인코더를 설정하는 중앙 보안 설정 클래스이다.
 * JWT 기반 인증을 사용하므로 세션은 STATELESS로 설정하고,
 * JwtFilter를 UsernamePasswordAuthenticationFilter 앞에 등록한다.
 *
 * [코드 흐름]
 * 1) Spring이 @Configuration + @EnableWebSecurity를 감지하여 보안 설정을 활성화한다.
 * 2) securityFilterChain()에서 HttpSecurity를 통해 보안 규칙을 구성한다.
 *    a) CORS 허용 — 모든 Origin/메서드/헤더 허용
 *    b) CSRF 비활성화 — REST API이므로 CSRF 토큰이 불필요
 *    c) 세션 STATELESS — JWT 토큰 기반이므로 서버 세션을 생성하지 않음
 *    d) 모든 요청 permitAll() — 인증은 JwtFilter에서 선택적으로 처리
 *    e) JwtFilter를 필터 체인에 추가
 * 3) passwordEncoder()가 BCryptPasswordEncoder 빈을 등록한다.
 *    AuthService에서 비밀번호 해싱/검증에 사용된다.
 *
 * [메서드 목록]
 * - securityFilterChain(HttpSecurity): SecurityFilterChain 빈 생성. CORS, CSRF, 세션, 인가 규칙, JWT 필터 설정.
 * - passwordEncoder(): BCryptPasswordEncoder 빈 생성. 비밀번호 암호화에 사용.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Configuration
 *   — Spring 설정 클래스 선언.
 *
 * @EnableWebSecurity
 *   — Spring Security의 웹 보안 기능을 활성화한다.
 *     SecurityFilterChain 빈을 통해 보안 규칙을 커스터마이징할 수 있게 한다.
 *
 * @Bean
 *   — 반환 객체를 Spring 빈으로 등록한다.
 *
 * HttpSecurity
 *   — Spring Security의 보안 설정 빌더. 체이닝 방식으로 CORS, CSRF,
 *     세션 정책, 인가 규칙, 필터 등을 설정한다.
 *
 * AbstractHttpConfigurer::disable
 *   — CSRF 보호를 비활성화하는 메서드 레퍼런스.
 *     REST API에서는 세션 기반 CSRF 토큰이 불필요하므로 끈다.
 *
 * SessionCreationPolicy.STATELESS
 *   — 서버가 HTTP 세션을 생성하지 않음. JWT 토큰으로 인증 상태를 관리한다.
 *
 * UsernamePasswordAuthenticationFilter
 *   — Spring Security의 기본 폼 로그인 인증 필터.
 *     JwtFilter를 이 필터 앞에 배치하여 JWT 인증이 먼저 처리되게 한다.
 *
 * BCryptPasswordEncoder
 *   — bcrypt 해시 알고리즘으로 비밀번호를 암호화/검증한다.
 *     encode()로 해싱, matches()로 평문↔해시 비교.
 * ───────────────────────────────────────────
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final JwtFilter jwtFilter;

    public SecurityConfig(JwtFilter jwtFilter) {
        this.jwtFilter = jwtFilter;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            // CORS 설정: 모든 Origin, 메서드, 헤더를 허용 (credentials는 false)
            .cors(cors -> cors.configurationSource(request -> {
                CorsConfiguration config = new CorsConfiguration();
                config.setAllowedOrigins(List.of("*"));
                config.setAllowedMethods(List.of("*"));
                config.setAllowedHeaders(List.of("*"));
                config.setAllowCredentials(false);
                return config;
            }))
            // REST API이므로 CSRF 보호를 비활성화
            .csrf(AbstractHttpConfigurer::disable)
            // JWT 기반 인증이므로 서버 세션을 생성하지 않음(STATELESS)
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            // 모든 요청을 허용 — 실제 인증 검증은 각 컨트롤러에서 JWT 토큰으로 수행
            .authorizeHttpRequests(auth -> auth
                .anyRequest().permitAll()
            )
            // JwtFilter를 UsernamePasswordAuthenticationFilter 앞에 추가하여 JWT 인증을 먼저 수행
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        // bcrypt 알고리즘으로 비밀번호를 해싱한다 (솔트 자동 생성, 강도 기본값 10)
        return new BCryptPasswordEncoder();
    }
}
