package com.mora.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;

/**
 * ═══════════════════════════════════════════════════════════════
 * RestTemplateConfig — 용도별 RestTemplate 빈 설정
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * Spring의 HTTP 클라이언트인 RestTemplate을 **용도별로 나눠** 빈으로 등록한다.
 * 나누는 기준은 "상대가 누구냐"가 아니라 **"이 호출을 앱이 몇 초까지 기다려 주느냐"** 이다.
 * 같은 업스트림이라도 호출 경로마다 앱 상한이 다르면 서버 read 상한도 달라야 한다.
 *  - ocrScanRestTemplate   : OcrService.scan()       → Python OCR 서버(Cloud Run) /api/scan
 *  - ocrDeleteRestTemplate : OcrService.deleteImage() → Python OCR 서버(Cloud Run) /uploads/{name}
 *  - embeddingRestTemplate : EmbeddingService        → OpenAI Embeddings API
 *
 * [코드 흐름]
 * 1) Spring이 @Configuration 클래스를 감지한다.
 * 2) 세 개의 @Bean 메서드가 각각 호출되어 서로 다른 타임아웃을 가진 RestTemplate 빈이 생성된다.
 * 3) OcrService / EmbeddingService 가 @Qualifier 로 **자기 용도의 빈을 명시 주입**한다.
 *
 * [왜 빈을 쪼갰나 — 타임아웃이 앱보다 길면 스레드가 샌다]
 * ───────────────────────────────────────────
 * 예전에는 `restTemplate()` 빈 하나를 OcrService와 EmbeddingService가 공유했고
 * read 타임아웃이 90초로 통일돼 있었다. 스캔 경로는 정합했지만(앱 120초 > 서버 90초)
 * **나머지 두 경로는 뒤집혀 있었다.**
 *
 * 앱이 XHR을 끊어도 Spring은 남은 시간 동안 Tomcat 워커 스레드를 계속 붙잡는다.
 * 사용자가 재시도를 반복하면 응답을 아무도 받지 않을 요청이 스레드에 쌓인다 —
 * 배포는 `--cpu 1 --max-instances 3`(server/cloudrun/deploy-spring.ps1)이라 여유가 없다.
 * **끊어진 요청을 서버가 붙잡고 있으면 "서버가 느리다"는 거짓 신호가 생긴다.**
 *
 * ═══════════════════════════════════════════════════════════════
 * [타임아웃 표 — 소비자 전수와 각 값의 근거]
 * ═══════════════════════════════════════════════════════════════
 *  빈                     소비자(호출 지점)                      앱 상한(상수)              connect  read   마진
 *  ──────────────────────┬──────────────────────────────────────┬─────────────────────────┬────────┬──────┬─────
 *  ocrScanRestTemplate   │ OcrService.scan()                    │ 120초                   │  5초   │ 90초 │ 30초
 *                        │  ← CardController POST /api/scan     │ SCAN_TIMEOUT_MS         │        │      │
 *                        │                                      │ (src/features/scan/api.ts:57)    │      │
 *  ──────────────────────┼──────────────────────────────────────┼─────────────────────────┼────────┼──────┼─────
 *  ocrDeleteRestTemplate │ OcrService.deleteImage()              │  15초                   │  5초   │ 10초 │  5초
 *                        │  ← CardService:240                    │ DEFAULT_TIMEOUT_MS      │        │      │
 *                        │      (DELETE /api/cards/{id})         │ (src/services/http.ts:29)        │      │
 *                        │  ← AuthService:148                    │                         │        │      │
 *                        │      (DELETE /auth/me)                │                         │        │      │
 *  ──────────────────────┼──────────────────────────────────────┼─────────────────────────┼────────┼──────┼─────
 *  embeddingRestTemplate │ EmbeddingService.embed()              │  20초                   │  5초   │ 15초 │  5초
 *                        │  ← CardService 저장/수정 경로         │ SAVE_TIMEOUT_MS         │        │      │
 *                        │      (POST /api/save)                 │ (src/features/scan/api.ts:69)    │      │
 *  ──────────────────────┴──────────────────────────────────────┴─────────────────────────┴────────┴──────┴─────
 *  (RestTemplate을 주입받는 지점은 OcrService·EmbeddingService **둘뿐**이다. 이 표가 전수다.)
 *
 * (1) CONNECT 5초 — 세 빈 공통
 *     TCP+TLS 수립 시간이다. Cloud Run 앞단(Google Frontend)이든 api.openai.com이든
 *     정상이면 1초 미만이다. 5초를 넘기면 네트워크/DNS 문제이지 추론 지연이 아니므로,
 *     여기서 빨리 끊어야 실패 원인이 "연결"로 좁혀진다.
 *     (connect 타임아웃은 OcrService.classifyIoFailure()가 **UNREACHABLE(503)** 로 분류한다 —
 *      "느리다"가 아니라 "못 붙었다"가 정확하기 때문. 근거는 그쪽 주석 참조.)
 *
 * (2) OCR SCAN READ 90초
 *     반드시 앱의 SCAN_TIMEOUT_MS(120초)보다 **짧아야 한다.** 그래야 앱이 끊기 전에
 *     서버가 먼저 명확한 에러(502/500/503/504)를 돌려줘 원인이 업스트림으로 좁혀진다.
 *     (네 갈래의 정의는 CardController 의 매핑 표 주석을 볼 것.)
 *
 *     [90초의 근거 — 실측 조건을 밝혀 다시 쓴다 (2026-08-05 4차)]
 *     이 자리에는 "1280x960 입력이 **1.87초**에 끝나므로" 가 적혀 있었다. 숫자 자체는
 *     실측이지만 **조건을 숨긴 인용**이었다. OCR 소요 시간은 입력 픽셀 수가 아니라
 *     **검출된 텍스트 블록 수**에 선형이다 — 인식(rec)이 검출 크롭마다 1회 돌기 때문이다.
 *     1.87초는 **블록 4개짜리 합성 이미지**의 값이고, 실제 명함은 그것보다 훨씬 촘촘하다.
 *     근거는 server/ocr/src/ocr/paddle_ocr_engine.py 의 __init__ 재측정 주석
 *     (1280x960 고정, 블록 수만 바꿔 측정: 1블록 약 1.0초 / 4블록 약 1.9초 /
 *      10블록 약 3.3초 / 21블록 약 6.4초 → 회귀식 t ≒ 0.73초 + 0.26초 x 블록수).
 *
 *     그래서 이 상한이 실제로 덮어야 하는 것은 다음 세 가지다.
 *       · 추론    : 명함 한 장은 통상 **15~25블록**이고, paddle_ocr_engine.py 는 그 구간을
 *                   **6~11초**로 적는다. 위 회귀식으로 직접 계산하면 4.6~7.2초이고,
 *                   절대값이 더 느렸던 격리 측정 환경(같은 21블록이 10.66초)으로 환산하면
 *                   약 8~12초다 — 즉 6~11초는 두 측정 환경 사이의 값이다.
 *                   **어느 쪽이 Cloud Run(--cpu 1)에 가까운지는 미확인이므로 느린 쪽으로 잡는다.**
 *                   최악을 잡아도 10초대다.
 *                   (peak 메모리는 블록 수·입력 해상도와 사실상 무관하게 약 1.0GB 로 평평하다.
 *                    시간과 메모리가 서로 다른 축에 걸린다는 것이 이 파이프라인의 핵심이다.)
 *       · 콜드스타트: 컨테이너 기동 + 모델 로드가 첫 요청 앞에 통째로 붙는다 — **실측 18~33초**.
 *                   min-instances=0 이라 잠든 뒤 첫 스캔에는 항상 이 비용이 얹힌다.
 *       · 합계    : 최악 약 13 + 33 = **약 46초**. 90초는 그 두 배 가까운 여유다.
 *
 *     결론(90초)은 그대로 유효하다 — 바뀐 것은 근거 문장뿐이다. 다만 여유의 크기가
 *     "1.87초 대비 48배" 가 아니라 "**46초 대비 약 2배**" 라는 것이 사실이고,
 *     이 값을 줄이려는 사람은 그 2배를 보고 판단해야 한다.
 *
 *     120 - 90 = 30초의 마진이 Spring이 에러 응답을 조립해 앱까지 보내는 시간을 보장한다.
 *
 *     **시간 수치를 이 파일에 옮겨 적을 때는 반드시 `해상도 + 블록 수 + 콜드/웜` 을 함께 적는다.**
 *     조건을 뗀 채 옮겨 적었기 때문에 같은 입력의 값이 문서 3곳에서 서로 다르게 갈렸다.
 *     실측치의 정본은 wiki/adr/ADR-002 Backend Connectivity.md §0 이다.
 *
 * (3) OCR DELETE READ 10초 — 빈 분리가 처음에 빠뜨렸던 세 번째 소비자
 *     삭제 경로는 스캔과 **같은 업스트림인데 앱 상한이 8배 짧다.** 앱은 이 요청을
 *     `src/services/http.ts` 의 일반 경로로 보내고 상한은 DEFAULT_TIMEOUT_MS(15초)다.
 *     그런데 직전 라운드까지 삭제도 scan용 빈(read 90초)을 그대로 썼다. 결과:
 *      - 앱은 15초에 끊고 사용자는 실패 화면을 보는데, Spring은 최대 75초를 더 매달린다.
 *      - AuthService.deleteAccount()는 **카드마다 순차 호출**이라(AuthService:145-150)
 *        명함 30장이면 최악 30 x 90초 = 45분을 `@Transactional` 안에서 붙잡는다.
 *        DB 커넥션과 워커 스레드가 그동안 통째로 묶인다.
 *     삭제 자체는 GCS 오브젝트 하나 지우는 호출이라 정상이면 수백 ms다. 10초면 충분하고,
 *     15 - 10 = 5초 마진 동안 Spring이 실패를 앱까지 돌려줄 수 있다.
 *
 *     **주의**: 이 값을 앱 상한(15초)보다 크게 올리면 위 역전이 그대로 되살아난다.
 *     늘려야 한다면 `src/services/http.ts` 의 DEFAULT_TIMEOUT_MS 부터 확인해라.
 *     (삭제 실패는 삼키지 않는다 — 호출부가 트랜잭션 롤백으로 재시도 가능성을 지키는
 *      계약이라서다. OcrService.deleteImage()의 주석 참조. 여기서는 상한만 조인다.)
 *
 * (4) 임베딩 READ 15초
 *     반드시 앱의 SAVE_TIMEOUT_MS(20초)보다 **짧아야 한다.** text-embedding-ada-002는
 *     명함 한 장 분량(수백 토큰)에 보통 1초 미만으로 답한다. 15초는 OpenAI 측 지연과
 *     재시도 없는 단발 호출을 감안한 상한이며, 20 - 15 = 5초의 마진 동안 Spring이
 *     임베딩을 포기하고(EmbeddingService는 실패 시 null 반환 → 부분성공) 저장을 마무리해
 *     앱에게 정상 응답을 돌려줄 수 있다. 임베딩이 없으면 벡터 검색만 약해질 뿐
 *     명함 저장 자체는 성공한다 — 20초를 넘겨 저장 전체를 실패시킬 이유가 없다.
 *
 * [@Primary 를 일부러 붙이지 않는다]
 * ───────────────────────────────────────────
 * 세 빈 중 어느 쪽도 기본값이 아니다. 새 코드가 `RestTemplate` 을 타입으로만 주입하면
 * NoUniqueBeanDefinitionException 으로 **기동 시점에 크게 실패한다.** 이것이 의도다 —
 * 조용히 아무 빈이나 붙어서 엉뚱한 타임아웃으로 도는 것보다, 주입할 때 용도를 밝히도록
 * 강제하는 편이 낫다. 이 규칙이 있었기에 삭제 경로가 scan용 90초 빈을 쓰고 있다는 사실도
 * 빈 이름을 훑는 것만으로 드러났다. 새 외부 호출을 추가하면 **위 타임아웃 표에 줄을 먼저
 * 추가하고** 빈을 만들어라.
 * ───────────────────────────────────────────
 *
 * [메서드 목록]
 * - ocrScanRestTemplate(): OCR 스캔 호출용 RestTemplate (connect 5초 / read 90초).
 * - ocrDeleteRestTemplate(): OCR 이미지 삭제 호출용 RestTemplate (connect 5초 / read 10초).
 * - embeddingRestTemplate(): OpenAI 임베딩 호출용 RestTemplate (connect 5초 / read 15초).
 * - newRestTemplate(Duration, Duration): 타임아웃을 지정해 RestTemplate을 만드는 공통 헬퍼.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Configuration
 *   — Spring 설정 클래스 선언. 내부 @Bean 메서드가 컨테이너에 등록된다.
 *
 * @Bean("이름")
 *   — 반환 객체를 지정한 이름의 Spring 빈으로 등록한다.
 *     같은 타입의 빈이 여럿일 때 @Qualifier 로 지목하기 위해 이름을 명시한다.
 *
 * RestTemplate
 *   — Spring에서 제공하는 동기식 HTTP 클라이언트.
 *     exchange(), getForObject(), delete() 등의 메서드로 외부 REST API를 호출한다.
 *
 * SimpleClientHttpRequestFactory
 *   — JDK 내장 HttpURLConnection 기반의 요청 팩토리.
 *     setConnectTimeout()/setReadTimeout()으로 소켓 타임아웃을 지정한다.
 *     별도 HTTP 클라이언트 의존성(Apache HttpClient 등)을 추가하지 않기 위해 기본 구현을 쓴다.
 *     **주의**: 기본값은 connect/read 둘 다 무한(-1)이다. 지정하지 않으면 워커 스레드가 영구 점유된다.
 *     또한 connect/read 타임아웃 **둘 다** SocketTimeoutException으로 던지므로,
 *     둘을 가르는 책임은 OcrService.classifyIoFailure()에 있다.
 *
 * Duration
 *   — java.time의 시간 간격 타입. 밀리초 정수 대신 단위를 코드에 드러내기 위해 사용한다.
 * ───────────────────────────────────────────
 */
@Configuration
public class RestTemplateConfig {

    /** TCP+TLS 수립 상한(세 빈 공통). 이걸 넘으면 추론 지연이 아니라 네트워크 문제다. */
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);

    /** OCR 스캔 응답 대기 상한. 앱의 SCAN_TIMEOUT_MS(120초)보다 짧아야 서버가 먼저 답할 수 있다. */
    private static final Duration OCR_SCAN_READ_TIMEOUT = Duration.ofSeconds(90);

    /**
     * OCR 이미지 삭제 응답 대기 상한.
     * 앱의 DEFAULT_TIMEOUT_MS(15초, src/services/http.ts:29)보다 **짧아야 한다** —
     * 근거는 위 [타임아웃 표] (3). 스캔용 90초를 여기 쓰면 계정 삭제가
     * 카드 수 x 90초를 트랜잭션 안에서 붙잡는다.
     */
    private static final Duration OCR_DELETE_READ_TIMEOUT = Duration.ofSeconds(10);

    /** 임베딩 응답 대기 상한. 앱의 SAVE_TIMEOUT_MS(20초)보다 짧아야 스레드가 새지 않는다. */
    private static final Duration EMBEDDING_READ_TIMEOUT = Duration.ofSeconds(15);

    /** OAuth 토큰 교환/프로필 조회 응답 대기 상한. 로그인 화면에서 기다리는 외부 API라 짧게 끊는다. */
    private static final Duration OAUTH_READ_TIMEOUT = Duration.ofSeconds(10);

    /** OCR 스캔(POST /api/scan) 전용. OcrService가 @Qualifier로 주입받는다. */
    @Bean("ocrScanRestTemplate")
    public RestTemplate ocrScanRestTemplate() {
        return newRestTemplate(CONNECT_TIMEOUT, OCR_SCAN_READ_TIMEOUT);
    }

    /** OCR 이미지 삭제(DELETE /uploads/{name}) 전용. OcrService가 @Qualifier로 주입받는다. */
    @Bean("ocrDeleteRestTemplate")
    public RestTemplate ocrDeleteRestTemplate() {
        return newRestTemplate(CONNECT_TIMEOUT, OCR_DELETE_READ_TIMEOUT);
    }

    /** OpenAI Embeddings API 호출 전용. EmbeddingService가 @Qualifier로 주입받는다. */
    @Bean("embeddingRestTemplate")
    public RestTemplate embeddingRestTemplate() {
        return newRestTemplate(CONNECT_TIMEOUT, EMBEDDING_READ_TIMEOUT);
    }

    /** OAuth provider 토큰 교환/프로필 조회 전용. GoogleOAuthService가 @Qualifier로 주입받는다. */
    @Bean("oauthRestTemplate")
    public RestTemplate oauthRestTemplate() {
        return newRestTemplate(CONNECT_TIMEOUT, OAUTH_READ_TIMEOUT);
    }

    /** 타임아웃만 다른 세 빈의 공통 생성 경로. 팩토리 설정 누락을 한 곳으로 모은다. */
    private RestTemplate newRestTemplate(Duration connectTimeout, Duration readTimeout) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(connectTimeout);
        factory.setReadTimeout(readTimeout);
        return new RestTemplate(factory);
    }
}
