package com.mora.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.List;

/**
 * ═══════════════════════════════════════════════════════════════
 * CorsConfig — CORS(Cross-Origin Resource Sharing) 정책 설정
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 프론트엔드(React 등)와 백엔드 간 도메인이 다를 때 발생하는
 * CORS 차단을 해결하기 위한 전역 필터를 등록한다.
 * 모든 Origin, 주요 HTTP 메서드, 모든 헤더를 허용하며
 * 쿠키/인증 헤더 전송(credentials)도 허용한다.
 *
 * [코드 흐름]
 * 1) Spring 컨텍스트가 @Configuration을 감지하여 이 클래스를 설정 빈으로 등록한다.
 * 2) corsFilter() 메서드가 CorsFilter 빈을 생성한다.
 * 3) 모든 경로("/**")에 대해 설정된 CORS 정책이 적용된다.
 * 4) 브라우저의 Preflight(OPTIONS) 요청 및 실제 요청 모두에 CORS 헤더가 포함된다.
 *
 * [메서드 목록]
 * - corsFilter(): CorsFilter 빈을 생성·반환한다. 모든 Origin/메서드/헤더 허용.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Configuration
 *   — 이 클래스가 Spring 설정 클래스임을 선언. 내부 @Bean 메서드가 빈으로 등록된다.
 *
 * @Bean
 *   — 메서드의 반환 객체를 Spring 컨테이너에 빈으로 등록한다.
 *
 * CorsConfiguration
 *   — CORS 정책(허용 Origin, 메서드, 헤더 등)을 담는 설정 객체.
 *
 * CorsConfiguration.setAllowedOriginPatterns()
 *   — 허용할 Origin 패턴 목록. "*"는 모든 도메인을 의미한다.
 *
 * CorsConfiguration.setAllowCredentials(true)
 *   — 쿠키, Authorization 헤더 등 인증 정보를 포함한 요청을 허용한다.
 *
 * UrlBasedCorsConfigurationSource
 *   — URL 패턴별로 CorsConfiguration을 매핑하는 소스.
 *
 * CorsFilter
 *   — 서블릿 필터로서 모든 HTTP 요청에 CORS 헤더를 추가한다.
 * ───────────────────────────────────────────
 */
@Configuration
public class CorsConfig {

    @Bean
    public CorsFilter corsFilter() {
        CorsConfiguration config = new CorsConfiguration();
        // 모든 Origin 패턴을 허용 (프론트엔드 개발 서버 포함)
        config.setAllowedOriginPatterns(List.of("*"));
        // GET, POST, PUT, DELETE, OPTIONS(Preflight) 메서드 허용
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        // 모든 요청 헤더 허용 (Authorization, Content-Type 등)
        config.setAllowedHeaders(List.of("*"));
        // 쿠키·인증 헤더를 포함한 요청을 허용
        config.setAllowCredentials(true);

        // 모든 경로("/**")에 위 CORS 설정을 적용
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return new CorsFilter(source);
    }
}
