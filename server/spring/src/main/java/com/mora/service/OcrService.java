package com.mora.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.PortUnreachableException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.Locale;
import java.util.Map;

/**
 * ═══════════════════════════════════════════════════════════════
 * OcrService — 외부 OCR(문자 인식) 서비스 호출 서비스
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 클라이언트가 업로드한 명함 이미지를 외부 Python OCR 서버
 * (PaddleOCR 기반)에 전달하여 문자 인식 결과를 받아오는 서비스이다.
 * CardController에서 /api/scan 엔드포인트 처리 시 호출된다.
 * 명함 이미지 삭제(deleteImage)도 같은 업스트림을 쓴다.
 *
 * [코드 흐름]
 * 1) CardController.scan()에서 MultipartFile(업로드된 이미지)과 함께 호출된다.
 * 2) MultipartFile을 ByteArrayResource로 변환한다 (RestTemplate 전송 가능 형태).
 * 3) multipart/form-data 요청을 구성한다 ("file" 파트에 이미지 첨부).
 * 4) RestTemplate.exchange()로 Python OCR 서버의 /api/scan 엔드포인트에 POST 요청.
 * 5) OCR 서버가 반환한 JSON 결과(이름, 회사, 직책, 전화번호 등)를 Map으로 반환한다.
 * 6) 실패 시 실패의 **종류를 보존한 채** OcrUpstreamException을 던진다 (아래 [실패 분류] 참조).
 *
 * [실패 분류 — 이 서비스가 예외를 뭉개지 않는 이유]
 * ───────────────────────────────────────────
 * 처음 코드는 모든 실패를 `new RuntimeException("OCR service call failed", e)` 하나로
 * 삼켜서 업스트림 상태코드를 완전히 소실시켰다. 그래서 OCR 인스턴스가 죽어 Google Frontend가
 * text/plain 503을 돌려주는 상황과, FastAPI가 추론에 실패해 500 + JSON을 돌려주는 상황과,
 * 아예 응답이 없는 타임아웃을 구분할 수 없었다. 앱에는 전부 불투명한 500만 도착했다.
 *
 * 이제 실패를 **네 갈래(OcrUpstreamException.Kind)** 로 나눠 던진다:
 *  - RestClientResponseException  → 업스트림이 상태코드를 돌려준 실패.
 *                                   5xx면 UPSTREAM_SERVER_ERROR, 4xx면 UPSTREAM_CLIENT_ERROR.
 *  - ResourceAccessException      → 응답 자체가 없다. cause를 뜯어 UNREACHABLE / TIMEOUT으로 가른다
 *                                   (아래 [연결 불가와 타임아웃을 가르는 이유] 참조).
 *  - 그 외                        → 예기치 못한 실패(파일 읽기 오류 등). RuntimeException 유지.
 *
 * 각 갈래가 어떤 HTTP 상태로 나가는지는 OcrUpstreamException의 [최종 매핑 표]가 원본이다.
 *
 * [연결 불가와 타임아웃을 가르는 이유 — 2차가 만든 회귀]
 * ───────────────────────────────────────────
 * 직전 라운드는 `ResourceAccessException`을 전부 `ofTimeout()` 하나로 접어 504를 냈다.
 * 그런데 `ResourceAccessException`은 **연결 단계 실패까지 포함**한다 —
 * `UnknownHostException`(DNS 없음), `ConnectException`(연결 거부), `NoRouteToHostException`.
 * `app.ocr-service-url`이 삭제된 Cloud Run 서비스를 가리키면 Spring은 **50ms**만에
 * UnknownHostException을 받는데, 앱에는 SCF-08 "문서를 읽는 데 **시간이 너무 오래 걸립니다** /
 * 잠시 후 다시 시도"가 떴다. 50ms에 끝난 DNS 실패를 "오래 걸린다"고 말하고,
 * 재시도로 절대 풀리지 않는 배포 설정 오류에 재시도 버튼을 주는 **이중 거짓 신호**였다.
 * 그래서 classifyIoFailure()가 cause 사슬을 뜯어 두 갈래로 가른다.
 *
 * [재시도를 넣지 않는 이유]
 * ───────────────────────────────────────────
 * **의도적으로 재시도하지 않는다.** 이번 장애에서는 요청 자체가 OCR 인스턴스를 죽였다
 * (중량 검출 모델이 원본 해상도로 돌아 peak RSS가 픽셀당 약 5.1KB로 선형 증가).
 * 같은 이미지를 재전송하면 갓 살아난 인스턴스를 다시 죽여 다운타임을 증폭시킬 뿐이다.
 * 재시도 판단은 사용자가(앱의 재시도 버튼으로) 내린다.
 *
 * [로깅 정책 — 서버 로그에는 스택트레이스를 남긴다]
 * ───────────────────────────────────────────
 * 한때 이 클래스는 `log.error("... (type={})", e.getClass().getSimpleName())` 처럼
 * **예외 타입명 한 단어만** 남기고 예외 객체를 버렸다. 그 결과 `file.getBytes()`가
 * IOException을 던져도 "어느 줄에서 무엇을 읽다 실패했는지" 알 방법이 아예 없어졌다.
 *
 * 그 판단은 틀렸다. **정보 은닉의 대상은 클라이언트 응답 본문이지 서버 로그가 아니다.**
 * Cloud Run 로그는 클라이언트에게 노출되지 않으며, 이 브랜치의 목표는 "장애 원인이
 * 서버로 곧장 좁혀지게" 하는 것이다. 스택트레이스를 지우면 그 목표를 스스로 깬다.
 *
 * 그래서 지금은:
 *  - 서버 로그  : `log.error(형식, 인자..., e)` 로 예외 객체를 마지막 인자에 넘겨
 *                 slf4j가 스택트레이스 전문을 찍게 한다. 업스트림 응답 본문이 예외
 *                 메시지에 섞여 들어와도 그대로 둔다 — 진단에 필요한 바로 그 정보다.
 *                 I/O 실패에는 판정된 Kind와 cause 타입명까지 같이 찍는다. 로그만 보고
 *                 "왜 503이 나갔나 / 왜 504가 나갔나"를 되짚을 수 있어야 하기 때문이다.
 *  - 응답 본문  : CardController가 손으로 조립한 문자열(상태코드 숫자 정도)만 나간다.
 *                 예외 메시지·본문·URL·파일명은 절대 실리지 않는다.
 *                 `application.yml`의 `server.error.include-*: never`(3efa5b7)가 2차 방어다.
 *
 * [메서드 목록]
 * - scan(MultipartFile file): 이미지를 OCR 서버에 보내고 인식 결과를 Map으로 반환한다.
 * - createFileHeaders(MultipartFile): 파일 파트의 Content-Type 헤더를 생성한다.
 * - deleteImage(String imageName): 명함 이미지를 OCR 서버(GCS/로컬)에서 삭제한다.
 * - classifyIoFailure(ResourceAccessException): 응답 없는 실패를 UNREACHABLE/TIMEOUT으로 가른다.
 * - isConnectPhaseTimeout(SocketTimeoutException): connect 타임아웃과 read 타임아웃을 구분한다.
 * - causeTypeName(Throwable): 로그용으로 cause 타입명을 뽑는다.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Service
 *   — 서비스 계층 빈 선언.
 *
 * @Value("${app.ocr-service-url}")
 *   — application.yml에서 OCR 서비스의 기본 URL을 주입한다.
 *     예: "http://localhost:8000"
 *
 * @SuppressWarnings("unchecked")
 *   — 제네릭 타입 캐스팅 경고 억제.
 *
 * [MultipartFile (Spring Web)]
 * ───────────────────────────────────────────
 * MultipartFile
 *   — 클라이언트가 업로드한 파일을 나타내는 인터페이스.
 *     getBytes()로 파일 내용을, getOriginalFilename()으로 원본 파일명을 얻는다.
 *
 * [ByteArrayResource (Spring Core)]
 * ───────────────────────────────────────────
 * ByteArrayResource
 *   — 바이트 배열을 Resource로 감싸는 클래스.
 *     getFilename()을 오버라이드하여 파일명을 지정해야
 *     RestTemplate이 multipart 파일 파트로 올바르게 전송한다.
 *
 * [RestTemplate 두 개를 주입받는 이유]
 * ───────────────────────────────────────────
 * 같은 업스트림이라도 **호출부의 앱 상한이 다르면 서버 read 상한도 달라야 한다.**
 *  - scan()        : 앱의 SCAN_TIMEOUT_MS(120초) 아래에서 돌아야 한다 → ocrScanRestTemplate(read 90초).
 *  - deleteImage() : 호출부가 DELETE /api/cards/{id}(CardService:240)와 DELETE /auth/me
 *                    (AuthService:148)이고, 이 둘은 앱의 일반 요청 경로라 상한이
 *                    `src/services/http.ts`의 DEFAULT_TIMEOUT_MS(15초)다
 *                    → ocrDeleteRestTemplate(read 10초).
 * 예전에는 삭제도 read 90초짜리 빈을 썼다. 앱이 15초에 끊은 뒤 Spring이 최대 75초를 더
 * 붙잡았고, AuthService.deleteAccount()는 카드마다 순차 호출이라 명함 30장이면 최대
 * 30×90초를 @Transactional 안에서 붙잡았다 — 근거는 RestTemplateConfig의 [타임아웃 표] 참조.
 *
 * restTemplate.exchange() / delete()
 *   — HTTP 요청을 보내고 응답을 받는다. 타임아웃은 주입된 빈이 갖고 있다.
 *
 * @Qualifier("ocrScanRestTemplate") / @Qualifier("ocrDeleteRestTemplate")
 *   — RestTemplate 빈이 용도별로 세 개(ocr-scan/ocr-delete/embedding) 등록돼 있으므로
 *     어느 쪽을 쓸지 명시한다. 생략하면 NoUniqueBeanDefinitionException으로 기동이
 *     실패한다 (의도된 설계 — RestTemplateConfig의 [@Primary를 일부러 붙이지 않는다] 참조).
 *
 * RestClientResponseException
 *   — 업스트림이 응답은 했지만 상태코드가 4xx/5xx인 경우 던져진다.
 *     HttpClientErrorException(4xx) · HttpServerErrorException(5xx) ·
 *     UnknownHttpStatusCodeException(비표준 코드)의 공통 상위 타입이라
 *     이것 하나로 "상태코드를 확보한 실패"를 전부 잡을 수 있다.
 *
 * ResourceAccessException
 *   — I/O 단계에서 실패해 응답 자체를 받지 못한 경우 던져진다.
 *     **연결 불가**(UnknownHostException·ConnectException·NoRouteToHostException)와
 *     **타임아웃**(SocketTimeoutException)이 한 타입에 섞여 있다.
 *     성질이 정반대이므로 classifyIoFailure()가 cause로 갈라낸다.
 *
 * [LinkedMultiValueMap (Spring Util)]
 * ───────────────────────────────────────────
 * LinkedMultiValueMap<String, Object>
 *   — multipart 요청의 각 파트를 key-value로 담는 맵.
 *     "file" 키에 HttpEntity<Resource>를 추가하여 파일 파트를 구성한다.
 *
 * [Logger (slf4j)]
 * ───────────────────────────────────────────
 * LoggerFactory.getLogger(OcrService.class)
 *   — 클래스 단위 로거. application.yml의 `logging.level.com.mora: INFO`로 노출 수준을 정한다.
 * ───────────────────────────────────────────
 */
@Service
public class OcrService {

    private static final Logger log = LoggerFactory.getLogger(OcrService.class);

    /**
     * cause 사슬을 따라가며 원인 타입을 찾을 때의 최대 깊이.
     * 실제로는 1~2단이면 끝나지만, 순환 참조(self-cause)나 비정상적으로 긴 사슬에
     * 무한 루프로 걸리지 않도록 상한을 둔다.
     */
    private static final int MAX_CAUSE_DEPTH = 8;

    /** OCR 스캔 전용 (connect 5초 / read 90초). 앱의 SCAN_TIMEOUT_MS(120초)보다 짧다. */
    private final RestTemplate scanRestTemplate;

    /** OCR 이미지 삭제 전용 (connect 5초 / read 10초). 앱의 DEFAULT_TIMEOUT_MS(15초)보다 짧다. */
    private final RestTemplate deleteRestTemplate;

    @Value("${app.ocr-service-url}")
    private String ocrServiceUrl;

    // 스캔과 삭제는 같은 업스트림이지만 **앱이 기다려 주는 시간이 다르다** → 빈도 다르다.
    // 근거는 위 [RestTemplate 두 개를 주입받는 이유]와 RestTemplateConfig의 [타임아웃 표] 참조.
    public OcrService(@Qualifier("ocrScanRestTemplate") RestTemplate scanRestTemplate,
                      @Qualifier("ocrDeleteRestTemplate") RestTemplate deleteRestTemplate) {
        this.scanRestTemplate = scanRestTemplate;
        this.deleteRestTemplate = deleteRestTemplate;
    }

    /**
     * 명함 이미지를 외부 OCR 서버에 전송하고 인식 결과를 반환한다.
     *
     * @param file 클라이언트가 업로드한 명함 이미지 파일
     * @return OCR 인식 결과 (이름, 회사, 직책, 전화번호, 이메일, 원본 텍스트 등)
     * @throws OcrUpstreamException OCR 업스트림이 4xx/5xx를 돌려주거나 응답하지 않은 경우
     * @throws RuntimeException 그 외 예기치 못한 실패 (파일 읽기 오류 등)
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> scan(MultipartFile file) {
        try {
            // 외부 OCR 서버로 보낼 HTTP 헤더 설정 (multipart/form-data)
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);

            // MultipartFile → ByteArrayResource 변환 (RestTemplate이 전송할 수 있는 형태)
            // getFilename()을 오버라이드해야 파일명이 multipart 파트에 포함된다
            ByteArrayResource resource = new ByteArrayResource(file.getBytes()) {
                @Override
                public String getFilename() {
                    return file.getOriginalFilename();
                }
            };

            // multipart 요청 바디 구성: "file" 파트에 이미지 파일 추가
            MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
            body.add("file", new HttpEntity<>(resource, createFileHeaders(file)));

            HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);

            // Python OCR 서버의 /api/scan 엔드포인트에 POST 요청
            // 재시도 없음 — 위 [재시도를 넣지 않는 이유] 참조.
            ResponseEntity<Map> response = scanRestTemplate.exchange(
                    ocrServiceUrl + "/api/scan",
                    HttpMethod.POST,
                    requestEntity,
                    Map.class
            );

            return response.getBody();
        } catch (RestClientResponseException e) {
            // 업스트림이 상태코드를 돌려준 실패. 503이면 인스턴스 사망(Google Frontend),
            // 500이면 FastAPI 추론 실패, 422면 multipart 계약 위반이다.
            // 이 숫자를 잃으면 원인 구분이 불가능해진다.
            //
            // 로그에 e를 넘겨 스택트레이스와 함께 업스트림 응답 본문까지 남긴다.
            // FastAPI의 422 본문에는 "어느 파트가 없다"가 그대로 적혀 있어 계약 위반을 즉시 특정할 수 있다.
            int status = e.getStatusCode().value();
            log.error("OCR scan upstream returned {} (type={})", status, e.getClass().getSimpleName(), e);
            throw OcrUpstreamException.ofStatus(status, e);
        } catch (ResourceAccessException e) {
            // 응답 자체를 받지 못했다. "못 붙었다(UNREACHABLE)"와 "느렸다(TIMEOUT)"는
            // 사용자에게 정반대의 안내가 나가야 하므로 cause로 갈라낸다.
            OcrUpstreamException mapped = classifyIoFailure(e);
            log.error("OCR scan upstream I/O failure kind={} (type={}, cause={})",
                    mapped.getKind(), e.getClass().getSimpleName(), causeTypeName(e), e);
            throw mapped;
        } catch (Exception e) {
            // 파일 읽기(IOException) 등 업스트림 이전 단계의 실패.
            // 타입명만 남기면 "어느 줄에서 무엇을 읽다 실패했는지"를 알 방법이 없다 → e를 그대로 넘긴다.
            // 클라이언트에게는 CardController가 조립한 "OCR processing failed"만 나가므로 유출이 아니다.
            log.error("OCR scan failed before upstream (type={})", e.getClass().getSimpleName(), e);
            throw new RuntimeException("OCR service call failed", e);
        }
    }

    /**
     * 파일 파트의 Content-Type 헤더를 생성한다.
     * MultipartFile의 contentType이 null이면 application/octet-stream을 사용한다.
     */
    private HttpHeaders createFileHeaders(MultipartFile file) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(
                file.getContentType() != null ? file.getContentType() : "application/octet-stream"));
        return headers;
    }

    /**
     * 명함 이미지를 OCR 서버(GCS/로컬)에서 삭제한다.
     *
     * 삭제 자체는 업스트림이 이미 멱등이다 — storage.delete_image()가 대상이 없어도 조용히 넘어간다.
     * 반면 **호출부의 계약은 "실패하면 던진다"** 이다: AuthService.deleteAccount()는 @Transactional
     * 안에서 이미지를 먼저 지우고 유저 row를 지우며, 이미지 삭제가 실패하면 롤백되어 유저 row가
     * 남아야 재시도가 가능하다(AuthService.java:143 주석). 그래서 여기서 예외를 삼키면 안 된다.
     * 실패 종류만 보존하도록 정리하고 던지는 동작은 그대로 둔다.
     *
     * **타임아웃은 scan()과 다른 빈(read 10초)을 쓴다.** 이 경로의 앱 상한이 15초라
     * scan용 90초 빈을 그대로 쓰면 앱이 끊은 뒤에도 Spring이 계속 매달린다 —
     * 위 [RestTemplate 두 개를 주입받는 이유] 참조.
     *
     * @param imageName /uploads/ 뒤의 이미지 파일명
     * @throws OcrUpstreamException 업스트림이 4xx/5xx를 돌려주거나 응답하지 않은 경우
     * @throws RuntimeException 그 외 예기치 못한 실패
     */
    public void deleteImage(String imageName) {
        try {
            deleteRestTemplate.delete(ocrServiceUrl + "/uploads/" + imageName);
        } catch (RestClientResponseException e) {
            // scan()과 같은 이유로 e를 로그에 넘긴다 (위 [로깅 정책] 참조).
            // 삭제 실패는 AuthService.deleteAccount()의 트랜잭션을 롤백시켜 유저 row를 남기므로,
            // 왜 실패했는지가 로그에 없으면 "계정이 안 지워진다"는 신고를 추적할 수 없다.
            int status = e.getStatusCode().value();
            log.error("OCR image delete upstream returned {} (type={})", status, e.getClass().getSimpleName(), e);
            throw OcrUpstreamException.ofStatus(status, e);
        } catch (ResourceAccessException e) {
            OcrUpstreamException mapped = classifyIoFailure(e);
            log.error("OCR image delete upstream I/O failure kind={} (type={}, cause={})",
                    mapped.getKind(), e.getClass().getSimpleName(), causeTypeName(e), e);
            throw mapped;
        } catch (Exception e) {
            log.error("OCR image delete failed (type={})", e.getClass().getSimpleName(), e);
            throw new RuntimeException("OCR image delete failed", e);
        }
    }

    /**
     * 응답을 받지 못한 실패(ResourceAccessException)를 **연결 불가**와 **타임아웃**으로 가른다.
     *
     * [왜 cause를 봐야 하나]
     * `ResourceAccessException` 은 Spring이 I/O 예외를 감싸는 단일 래퍼라, 그 자체로는
     * "DNS가 없어서 50ms만에 실패"와 "90초를 기다렸는데 응답이 없음"을 구분할 수 없다.
     * 실제 정보는 전부 cause에 들어 있다.
     *
     * [분류 규칙]
     *  - SocketTimeoutException   → 타임아웃. 단 아래 [connect 타임아웃] 예외 규칙이 우선한다.
     *  - UnknownHostException     → 연결 불가. 호스트명이 DNS에 없다. 대개 URL 오타이거나
     *                               Cloud Run 서비스가 삭제된 경우다.
     *  - ConnectException         → 연결 불가. "Connection refused" — 포트가 닫혀 있다.
     *  - NoRouteToHostException   → 연결 불가. 네트워크/방화벽이 경로를 끊었다.
     *  - PortUnreachableException → 연결 불가. ICMP port unreachable.
     *
     * [connect 타임아웃은 왜 연결 불가로 접나]
     * JDK의 HttpURLConnection(SimpleClientHttpRequestFactory가 쓰는 구현)은 connect 단계
     * 타임아웃과 read 단계 타임아웃 **둘 다** SocketTimeoutException으로 던진다.
     * 구분할 수 있는 단서는 메시지뿐이다 — connect는 "Connect timed out"(구 JDK는 소문자),
     * read는 "Read timed out". 둘 다 JDK 소스에 하드코딩된 영문 리터럴이라 로케일 영향이 없다.
     * connect 5초를 못 넘겼다는 것은 "느린 추론"이 아니라 방화벽이 SYN을 버렸다는 뜻이므로
     * 성질상 연결 불가에 가깝다. 메시지 형식이 바뀌면 아래 기본값(타임아웃)으로 조용히
     * 되돌아갈 뿐 오분류가 커지지 않는다 — 그래서 문자열 비교를 감수한다.
     *
     * [cause가 불명확하면 UNREACHABLE로 떨어뜨린다]
     * 알 수 없는 cause(예: "Connection reset", NoHttpResponseException)일 때는
     * **UNREACHABLE로 보낸다.** 타임아웃은 SocketTimeoutException으로만 증명되는 사실이고,
     * 증명되지 않은 실패를 "시간이 오래 걸렸다"고 말하는 것이 바로 이번에 없애려는 거짓
     * 신호이기 때문이다. UNREACHABLE("호출을 완주하지 못했다")이 더 약하고 정직한 주장이다.
     *
     * @param e Spring이 던진 I/O 실패 래퍼
     * @return UNREACHABLE 또는 TIMEOUT 갈래의 OcrUpstreamException (cause는 e 그대로 체이닝)
     */
    private static OcrUpstreamException classifyIoFailure(ResourceAccessException e) {
        Throwable cause = e.getCause();
        for (int depth = 0; cause != null && depth < MAX_CAUSE_DEPTH; depth++) {
            if (cause instanceof SocketTimeoutException timeout) {
                return isConnectPhaseTimeout(timeout)
                        ? OcrUpstreamException.ofUnreachable(e)
                        : OcrUpstreamException.ofTimeout(e);
            }
            if (cause instanceof UnknownHostException
                    || cause instanceof ConnectException
                    || cause instanceof NoRouteToHostException
                    || cause instanceof PortUnreachableException) {
                return OcrUpstreamException.ofUnreachable(e);
            }
            Throwable next = cause.getCause();
            if (next == cause) break; // 자기 자신을 cause로 갖는 비정상 예외 방어
            cause = next;
        }
        // 판정 근거 없음 → 증명되지 않은 "타임아웃" 대신 더 약한 주장인 UNREACHABLE.
        return OcrUpstreamException.ofUnreachable(e);
    }

    /**
     * SocketTimeoutException이 connect 단계에서 났는지(=사실상 연결 불가) 판별한다.
     * 근거와 한계는 classifyIoFailure()의 [connect 타임아웃은 왜 연결 불가로 접나] 참조.
     */
    private static boolean isConnectPhaseTimeout(SocketTimeoutException e) {
        String message = e.getMessage();
        // JDK 리터럴: NioSocketImpl "Connect timed out" / 구 PlainSocketImpl "connect timed out".
        // read 쪽은 "Read timed out" 이라 접두사만으로 안전하게 갈린다.
        return message != null && message.toLowerCase(Locale.ROOT).startsWith("connect");
    }

    /** 로그용 cause 타입명. cause가 없으면 "none". 응답 본문에는 절대 쓰이지 않는다. */
    private static String causeTypeName(Throwable e) {
        Throwable cause = e.getCause();
        return cause == null ? "none" : cause.getClass().getName();
    }
}
