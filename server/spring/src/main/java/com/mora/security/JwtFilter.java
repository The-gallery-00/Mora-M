package com.mora.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;
import java.util.UUID;

/**
 * ═══════════════════════════════════════════════════════════════
 * JwtFilter — JWT 토큰 인증 필터
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 매 HTTP 요청마다 Authorization 헤더에서 JWT 토큰을 추출하여
 * 유효성을 검증하고, 유효한 경우 Spring Security의
 * SecurityContext에 인증 정보를 설정하는 서블릿 필터이다.
 * SecurityConfig에서 UsernamePasswordAuthenticationFilter 앞에 등록된다.
 *
 * [코드 흐름]
 * 1) 클라이언트가 HTTP 요청을 보낸다.
 * 2) SecurityFilterChain에 의해 JwtFilter.doFilterInternal()이 호출된다.
 * 3) Authorization 헤더에서 "Bearer {token}" 형식으로 토큰을 추출한다.
 * 4) JwtUtil.isValid()로 토큰의 유효성(서명, 만료)을 검증한다.
 * 5) 유효하면 JwtUtil.getUserId()로 사용자 UUID를 추출한다.
 * 6) UsernamePasswordAuthenticationToken을 생성하여 SecurityContext에 설정한다.
 *    → 이후 컨트롤러에서 SecurityContextHolder.getContext().getAuthentication()으로
 *      인증된 사용자 정보를 조회할 수 있다.
 * 7) filterChain.doFilter()로 다음 필터로 요청을 전달한다.
 *
 * [메서드 목록]
 * - doFilterInternal(request, response, filterChain):
 *   요청 헤더에서 JWT를 추출·검증하고 SecurityContext에 인증 정보를 설정한다.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Component
 *   — Spring 빈으로 자동 등록. SecurityConfig에서 주입받아 필터 체인에 추가한다.
 *
 * OncePerRequestFilter (Spring Web)
 *   — 하나의 요청당 정확히 한 번만 실행되는 필터의 기반 클래스.
 *     doFilterInternal()을 오버라이드하여 필터 로직을 구현한다.
 *
 * UsernamePasswordAuthenticationToken (Spring Security)
 *   — 인증된 사용자를 나타내는 Authentication 구현체.
 *     principal(사용자 ID), credentials(null), authorities(권한 목록)를 담는다.
 *
 * SecurityContextHolder (Spring Security)
 *   — 현재 스레드의 SecurityContext를 관리한다.
 *     setAuthentication()으로 인증 정보를 저장하면
 *     이후 동일 요청에서 인증된 사용자로 인식된다.
 *
 * FilterChain.doFilter()
 *   — 다음 필터로 요청을 전달한다. 이를 호출하지 않으면 요청이 중단된다.
 * ───────────────────────────────────────────
 */
@Component
public class JwtFilter extends OncePerRequestFilter {

    private final JwtUtil jwtUtil;

    public JwtFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        // Authorization 헤더에서 "Bearer {token}" 형식의 토큰을 추출
        String header = request.getHeader("Authorization");

        if (header != null && header.startsWith("Bearer ")) {
            // "Bearer " 접두사(7자)를 제거하여 순수 토큰 문자열을 얻는다
            String token = header.substring(7);
            if (jwtUtil.isValid(token)) {
                // 토큰에서 사용자 UUID를 추출
                UUID userId = jwtUtil.getUserId(token);
                // Spring Security의 Authentication 객체를 생성 (principal=userId, credentials=null, authorities=빈 목록)
                UsernamePasswordAuthenticationToken auth =
                        new UsernamePasswordAuthenticationToken(userId, null, Collections.emptyList());
                // SecurityContext에 인증 정보를 설정 → 이후 요청에서 인증된 사용자로 인식
                SecurityContextHolder.getContext().setAuthentication(auth);
            }
        }

        // 다음 필터로 요청 전달 (반드시 호출해야 요청이 계속 진행됨)
        filterChain.doFilter(request, response);
    }
}
