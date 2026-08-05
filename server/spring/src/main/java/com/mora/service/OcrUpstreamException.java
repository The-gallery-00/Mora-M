package com.mora.service;

/**
 * ═══════════════════════════════════════════════════════════════
 * OcrUpstreamException — OCR 업스트림 호출 실패 예외
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * OcrService가 외부 Python OCR 서버를 호출하다 실패했을 때, **업스트림에서 실제로
 * 무슨 일이 벌어졌는지**를 잃지 않고 컨트롤러까지 전달하기 위한 예외이다.
 * 기존에는 모든 실패가 `new RuntimeException("OCR service call failed", e)` 하나로
 * 뭉개져서 503(인스턴스 사망)인지 500(추론 실패)인지 타임아웃인지 구분할 수 없었고,
 * 앱에는 불투명한 500만 도착했다.
 *
 * [코드 흐름]
 * 1) OcrService.scan()/deleteImage()가 RestTemplate 예외를 잡는다.
 * 2) 상태코드가 있는 실패(4xx/5xx)면 ofStatus()로 그 숫자와 Kind를 담아 던진다.
 * 3) 응답 자체가 없는 실패면 OcrService.classifyIoFailure()가 cause를 뜯어
 *    UNREACHABLE / TIMEOUT 중 하나로 갈라 ofUnreachable() 또는 ofTimeout()으로 던진다.
 * 4) CardController.scan()이 Kind 하나만 보고 아래 [최종 매핑 표]대로 HTTP 응답을 만든다.
 *
 * ═══════════════════════════════════════════════════════════════
 * [최종 매핑 표 — Kind → Spring 응답 → 응답 본문]
 * ═══════════════════════════════════════════════════════════════
 *  Kind                   | 상황                                  | Spring | 본문 메시지
 *  ───────────────────────┼───────────────────────────────────────┼────────┼──────────────────────────────────
 *  UPSTREAM_SERVER_ERROR  | 업스트림이 5xx로 응답                  |  502   | "OCR upstream failed (nnn)"
 *                         | (인스턴스 사망 503 · 추론 실패 500)    |        |
 *  UPSTREAM_CLIENT_ERROR  | 업스트림이 4xx로 응답                  |  500   | "OCR upstream contract error (nnn)"
 *                         | (Spring↔OCR 계약 위반 422 등)          |        |
 *  UNREACHABLE            | 연결 불가 (DNS 실패·연결 거부·         |  503   | "OCR upstream unreachable"
 *                         |  라우팅 없음)                          |        |
 *  TIMEOUT                | read 타임아웃 (연결은 됐는데 응답 없음)|  504   | "OCR upstream timeout"
 *  ───────────────────────┴───────────────────────────────────────┴────────┴──────────────────────────────────
 *  (이 예외가 아예 던져지지 않은 그 외 예기치 못한 실패는 RuntimeException → 500 "OCR processing failed")
 *
 *  nnn = 업스트림이 실제로 돌려준 상태코드. 숫자만 넣고 예외 원문·URL·파일명은 넣지 않는다.
 *
 * [왜 4갈래인가 — 2갈래·3갈래가 만든 거짓 신호들]
 * ───────────────────────────────────────────
 * (a) 1차: 상태코드 있는 실패를 4xx/5xx 구분 없이 전부 502로 접었다.
 *     앱은 502를 `SCF-07 "OCR 서버에 연결할 수 없습니다." + [다시 시도]`로 안내한다.
 *     multipart 파트명이 어긋나 FastAPI가 **422**를 내는 상황에서도 앱은 "서버가 죽었다"고
 *     말하며 재시도 버튼을 주고, 사용자가 몇 번을 눌러도 같은 422가 반복된다 —
 *     **재시도로 절대 풀리지 않는 실패를 재시도하라고 안내하는 거짓 신호**다.
 *     → UPSTREAM_CLIENT_ERROR를 갈라 500("서버 내부 오류")으로 보낸다. 고칠 주체는
 *       사용자가 아니라 서버 코드다. 다만 본문에 업스트림 숫자를 남겨 진단은 가능하게 둔다.
 *
 * (b) 2차: 응답 없는 실패를 전부 `ofTimeout()` 하나로 접어 504를 냈다.
 *     그런데 `ResourceAccessException`은 `UnknownHostException`·`ConnectException`도 포함한다.
 *     `OCR_SERVICE_URL`이 삭제된 서비스를 가리키면 Spring은 **50ms**만에 UnknownHostException을
 *     받는데, 앱에는 SCF-08 "문서를 읽는 데 **시간이 너무 오래 걸립니다** / 잠시 후 다시 시도"가
 *     떴다. 50ms에 끝난 DNS 실패를 "오래 걸린다"고 말하고, 재시도로 절대 풀리지 않는데
 *     재시도 버튼을 주는 **이중 거짓 신호**다.
 *     → UNREACHABLE(503)과 TIMEOUT(504)을 갈랐다. 503은 "배포/설정이 잘못됐다",
 *       504는 "붙긴 했는데 시간 안에 답이 없었다"로 성질이 정반대다.
 *
 * [정보 은닉 원칙 — 대상은 "클라이언트 응답"이지 "서버 로그"가 아니다]
 * ───────────────────────────────────────────
 * 이 예외의 **메시지**에는 업스트림 URL·파일명·응답 본문을 절대 담지 않는다.
 * 업스트림 응답 본문에는 파일명이나 스택트레이스가 섞여 들어올 수 있고,
 * 컨트롤러가 이 메시지를 그대로 본문에 실어 나를 수 있기 때문이다.
 *
 * 반면 **원인 예외(cause)는 체이닝한다.** 한때 "cause의 메시지가 새어나간다"는 이유로
 * cause를 떼어냈지만, 그 판단은 틀렸다:
 *  - 클라이언트로 나가는 본문은 컨트롤러가 손으로 조립한 문자열뿐이다
 *    (`ApiResponse.fail("OCR upstream failed (503)")` 처럼 숫자만 넣는다).
 *    cause는 물론 이 예외의 getMessage()조차 자동으로 직렬화되지 않는다.
 *  - 혹시 누락돼 Spring 기본 에러 핸들러까지 올라가도
 *    `application.yml`의 `server.error.include-message/include-stacktrace: never`(3efa5b7)가 막는다.
 *  - 반대로 cause가 없으면 **서버 로그에서 원인을 좁힐 수단이 사라진다.**
 *    이 브랜치의 목표가 "원인이 서버로 곧장 좁혀지게" 하는 것이므로 정면 충돌한다.
 * 즉 은닉해야 할 것은 응답 본문이고, 로그는 최대한 자세해야 한다.
 *
 * [메서드 목록]
 * - getKind(): 실패 갈래. 컨트롤러는 **이것 하나만** 보고 상태코드를 정한다.
 * - getUpstreamStatus(): 업스트림 HTTP 상태코드. 응답 자체가 없었으면 NO_STATUS(0).
 * - ofStatus(int, Throwable): 업스트림이 상태코드를 돌려준 실패. 5xx/4xx를 Kind로 갈라 담는다.
 * - ofUnreachable(Throwable): 연결 자체가 성립하지 않은 실패.
 * - ofTimeout(Throwable): 연결은 됐으나 응답이 상한 안에 오지 않은 실패.
 *
 * [불리언 술어(isTimeout/isUpstreamServerError/...)를 없앤 이유]
 * ───────────────────────────────────────────
 * 예전에는 `isTimeout()`·`hasStatus()`·`isUpstreamServerError()`·`isUpstreamClientError()`
 * 네 개의 술어를 두고 컨트롤러가 if를 늘어놨다. 문제는 두 가지였다:
 *  - `isTimeout()`이 "연결 실패 또는 읽기 타임아웃"이라는 **두 가지 서로 다른 뜻**을 갖고 있어
 *    이름 자체가 거짓 신호였다. (b)의 원인이다.
 *  - if 사슬은 갈래를 하나 빠뜨려도 조용히 마지막 else로 떨어진다. 실제로 그렇게 떨어진 게
 *    504였고, 그게 (b)의 증상을 만들었다.
 * 지금은 enum Kind 하나로 좁히고 컨트롤러가 **switch 식**으로 받는다. 갈래를 늘리면
 * switch 식의 exhaustiveness 검사가 **컴파일을 깨뜨린다** — 조용히 틀린 코드로 도는 대신
 * 빌드가 멈춘다.
 * ───────────────────────────────────────────
 *
 * [패키지 위치]
 * ───────────────────────────────────────────
 * 이 레포에는 별도의 exception 패키지가 없고, 서비스 계층이 전부 RuntimeException을
 * 직접 던지는 관례다(AuthService, CardService 등). 새 패키지를 만드는 대신
 * 유일한 발생지인 com.mora.service 안에 두어 기존 구조를 유지한다.
 * RuntimeException을 상속하므로 `catch (RuntimeException e)`로 잡는 기존 컨트롤러들의
 * 동작(AuthController.deleteMe → 400 등)은 그대로 유지된다.
 * ───────────────────────────────────────────
 */
public class OcrUpstreamException extends RuntimeException {

    /**
     * OCR 업스트림 호출이 실패하는 네 가지 갈래.
     *
     * 상수 하나가 곧 HTTP 응답 하나다 — 위 [최종 매핑 표] 참조.
     * **여기에 상수를 추가하면 CardController.scan()의 switch 식이 컴파일 에러를 낸다.**
     * 의도된 설계다: 새 갈래가 조용히 기존 갈래의 문구를 뒤집어쓰는 일을 막는다.
     */
    public enum Kind {
        /** 업스트림이 5xx로 응답했다. 인스턴스 사망(503)·추론 실패(500)·게이트웨이 오류(502). → 502 */
        UPSTREAM_SERVER_ERROR,
        /** 업스트림이 4xx로 응답했다. Spring↔OCR 계약 위반(422 등). 재시도로 풀리지 않는다. → 500 */
        UPSTREAM_CLIENT_ERROR,
        /** 연결 자체가 성립하지 않았다. DNS 실패·연결 거부·라우팅 없음. 배포/설정 문제다. → 503 */
        UNREACHABLE,
        /** 연결은 됐는데 응답이 read 상한 안에 오지 않았다. 콜드스타트·과부하. → 504 */
        TIMEOUT
    }

    /** 업스트림 응답 자체가 없었을 때(연결 불가·타임아웃)의 상태코드 자리표시자. */
    public static final int NO_STATUS = 0;

    /**
     * 이 값 이상이면 업스트림 서버 측 실패로 본다. 미만이면 요청 측(계약) 실패다.
     * 표준 밖의 큰 코드(예: Cloudflare 52x)도 서버 측 실패로 접힌다 — 성질이 같다.
     */
    private static final int SERVER_ERROR_THRESHOLD = 500;

    /** 실패 갈래. 컨트롤러의 유일한 분기 기준. */
    private final Kind kind;

    /** 업스트림이 돌려준 HTTP 상태코드. 응답이 없었으면 NO_STATUS. */
    private final int upstreamStatus;

    private OcrUpstreamException(String message, Kind kind, int upstreamStatus, Throwable cause) {
        // cause를 체이닝한다 (위 [정보 은닉 원칙] 참조 — 은닉 대상은 응답 본문이지 로그가 아니다).
        super(message, cause);
        this.kind = kind;
        this.upstreamStatus = upstreamStatus;
    }

    /**
     * 업스트림이 4xx/5xx 응답을 돌려준 경우. 상태코드를 보존하고 5xx/4xx를 Kind로 가른다.
     *
     * @param upstreamStatus 업스트림이 돌려준 HTTP 상태코드
     * @param cause          원인 예외(RestClientResponseException). 서버 로그용으로만 쓰인다.
     */
    public static OcrUpstreamException ofStatus(int upstreamStatus, Throwable cause) {
        Kind kind = upstreamStatus >= SERVER_ERROR_THRESHOLD
                ? Kind.UPSTREAM_SERVER_ERROR
                : Kind.UPSTREAM_CLIENT_ERROR;
        // 메시지에 숫자만 넣는다. 업스트림 응답 본문은 cause 쪽에만 남아 로그로 간다.
        return new OcrUpstreamException("OCR upstream responded " + upstreamStatus, kind, upstreamStatus, cause);
    }

    /**
     * 연결 자체가 성립하지 않은 경우(DNS 실패·연결 거부·라우팅 없음).
     * 상태코드가 없으므로 upstreamStatus는 NO_STATUS다.
     *
     * @param cause 원인 예외(ResourceAccessException). 서버 로그용으로만 쓰인다.
     */
    public static OcrUpstreamException ofUnreachable(Throwable cause) {
        return new OcrUpstreamException("OCR upstream unreachable", Kind.UNREACHABLE, NO_STATUS, cause);
    }

    /**
     * 연결은 됐으나 응답이 read 상한 안에 오지 않은 경우.
     *
     * @param cause 원인 예외(ResourceAccessException). 서버 로그용으로만 쓰인다.
     */
    public static OcrUpstreamException ofTimeout(Throwable cause) {
        return new OcrUpstreamException("OCR upstream timeout", Kind.TIMEOUT, NO_STATUS, cause);
    }

    /** 실패 갈래. CardController는 이것 하나만 보고 상태코드와 본문을 정한다. */
    public Kind getKind() {
        return kind;
    }

    /**
     * 업스트림이 돌려준 HTTP 상태코드. 응답이 없었으면 NO_STATUS(0).
     * UPSTREAM_SERVER_ERROR / UPSTREAM_CLIENT_ERROR 일 때만 의미가 있다.
     */
    public int getUpstreamStatus() {
        return upstreamStatus;
    }
}
