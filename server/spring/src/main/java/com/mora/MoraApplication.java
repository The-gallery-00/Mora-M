package com.mora;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * ═══════════════════════════════════════════════════════════════
 * MoraApplication — Spring Boot 애플리케이션 진입점(Entry Point)
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * MORA(명함 OCR 관리) 프로젝트의 메인 클래스이다.
 * Spring Boot 애플리케이션을 초기화하고 실행하는 역할을 한다.
 * 이 클래스가 실행되면 내장 톰캣 서버가 기동되고,
 * com.mora 패키지 하위의 모든 컴포넌트(@Controller, @Service,
 * @Repository, @Configuration 등)가 자동으로 스캔·등록된다.
 *
 * [코드 흐름]
 * 1) JVM이 main() 메서드를 호출한다.
 * 2) SpringApplication.run()이 Spring 컨텍스트를 생성한다.
 * 3) @SpringBootApplication에 의해 컴포넌트 스캔, 자동 설정,
 *    프로퍼티 로딩 등이 수행된다.
 * 4) 내장 톰캣이 기동되어 HTTP 요청을 수신할 준비를 한다.
 *
 * [메서드 목록]
 * - main(String[] args): 애플리케이션 시작점. SpringApplication.run()을 호출한다.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @SpringBootApplication
 *   — @Configuration + @EnableAutoConfiguration + @ComponentScan의 조합.
 *     Spring Boot의 자동 설정과 컴포넌트 스캔을 한 번에 활성화한다.
 *
 * SpringApplication.run()
 *   — Spring ApplicationContext를 생성하고, 내장 웹 서버를 시작하며,
 *     CommandLineRunner 등 초기화 로직을 실행한다.
 * ───────────────────────────────────────────
 */
@SpringBootApplication
public class MoraApplication {

    public static void main(String[] args) {
        // Spring Boot 애플리케이션 컨텍스트를 초기화하고 내장 톰캣을 기동한다
        SpringApplication.run(MoraApplication.class, args);
    }
}
