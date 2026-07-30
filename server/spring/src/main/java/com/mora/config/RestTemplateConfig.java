package com.mora.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

/**
 * ═══════════════════════════════════════════════════════════════
 * RestTemplateConfig — RestTemplate 빈 설정
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * Spring의 HTTP 클라이언트인 RestTemplate을 빈으로 등록하여
 * 프로젝트 전반에서 외부 API 호출 시 주입받아 사용할 수 있게 한다.
 * OcrService(Python OCR 서버 호출), EmbeddingService(OpenAI API 호출)
 * 등에서 이 빈을 사용한다.
 *
 * [코드 흐름]
 * 1) Spring이 @Configuration 클래스를 감지한다.
 * 2) restTemplate() 메서드가 호출되어 RestTemplate 빈이 생성된다.
 * 3) OcrService, EmbeddingService 등에서 생성자 주입으로 이 빈을 받아 사용한다.
 *
 * [메서드 목록]
 * - restTemplate(): RestTemplate 인스턴스를 생성·반환한다.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Configuration
 *   — Spring 설정 클래스 선언. 내부 @Bean 메서드가 컨테이너에 등록된다.
 *
 * @Bean
 *   — 반환 객체를 Spring 빈으로 등록한다.
 *
 * RestTemplate
 *   — Spring에서 제공하는 동기식 HTTP 클라이언트.
 *     exchange(), getForObject(), postForEntity() 등의 메서드로
 *     외부 REST API를 호출할 수 있다.
 * ───────────────────────────────────────────
 */
@Configuration
public class RestTemplateConfig {

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}
