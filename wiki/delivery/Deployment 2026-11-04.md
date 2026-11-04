# 모바일 서버 전환 및 내부 테스트 빌드 (2026-11-04)

## 판정

최신 `dev`의 앱·서버 변경을 배포하고 내부 테스트용 APK/AAB를 생성했다.
서버 통합 확인은 통과했지만 실기기 검증과 의존성 보안 보완이 남아 있으므로 공개 출시 승인 기록은 아니다.

- 소스 기준: `0619e60` (PR #48 머지, 보안 PR #47 포함).
- 작업 브랜치: `feature/release-deployment`.
- 앱 코드 변경 없이 `.easignore`에서 서버·모델·기존 산출물·로컬 서명 파일을 제외했다.
- Play Console 업로드, 내부 테스트 출시 버튼, 프로덕션 제출은 수행하지 않았다.

## 적용한 운영 변경

| 항목 | 확인 결과 |
|---|---|
| 프로젝트 / 리전 | `mora-mobile` / `asia-northeast3` |
| Spring 최종 리비전 | `mora-mobile-spring-00024-zex`, 트래픽 100% |
| OCR 최종 리비전 | `mora-mobile-ocr-00009-wug`, 트래픽 100% |
| Spring 자원 | 1 CPU / 1 GiB, 동시성 80, 최대 3 / 최소 0 |
| OCR 자원 | 1 CPU / 2 GiB, 동시성 4, 최대 3 / 최소 0 |
| SQL | `mora-mobile-db`, `mora`, V1~V9 성공 |
| 수동 백업 | `1793796771816`, `SUCCESSFUL`, `pre-security-release-0619e60` |
| 새 인증 비밀정보 | `mora-ocr-service-secret:1`, 두 서비스의 `OCR_SHARED_SECRET`에 연결 |
| 권한 | 해당 비밀정보에 한해 Spring·OCR 실행 계정에 `secretAccessor` 부여 |
| 버킷 | `mora-mobile-uploads`, uniform bucket access 유지, public access prevention `enforced` |
| 삭제 보관 | GCS soft delete 7일 유지. 활성 객체 삭제와 즉시 영구 소거는 다름 |
| 기존 설정 | DB 비밀번호·JWT·소셜 클라이언트 Secret 참조, 14일 JWT, OAuth 콜백과 앱 복귀 설정 유지 |

비밀정보 값은 명령 인자·소스·앱 환경변수에 넣지 않았다. EAS가 임시로 내려받은 서명 키 사본과
자격증명 JSON은 빌드 후 삭제했다. Expo의 원본 서명 자격증명은 변경하지 않았다.

운영 전환 전 새 리비전을 0% 트래픽의 태그 주소에서 확인했다.
검증 후 Spring과 OCR를 전환하고 Spring의 OCR 주소를 고정 운영 주소로 정리했다.
사용한 검증 태그는 제거했다. SQL 스키마는 새 Spring 시작 시 적용되므로 0% 트래픽이
운영 DB 변경까지 격리한다는 뜻은 아니다. 백업과 별도 DB 사전 검증을 먼저 수행했다.

## 이미지 및 DB 보존 확인

운영 DB 읽기 전용 점검 후 이미지 참조만 보존하고 사용자 ID는 임의 값으로 치환한
임시 PostgreSQL에서 V8/V9를 적용해 소유권 이전 충돌이 없는 것을 확인했다.
임시 DB는 검사 후 제거했다. 전체 운영 백업의 실제 복원 훈련을 수행한 것은 아니다.

- 배포 전후 기존 사용자 45명, 명함 23건·포스터 14건·티켓 12건·영수증 4건 유지.
- 기존 원본 참조 50개 소유권 등록. 미등록·다른 소유자 참조 0개.
- 테스트 종료 후 합성 사용자 0명, 삭제 재시도 대기 0개.
- 배포 전에 이미 GCS에서 찾을 수 없던 원본 4개가 있었다. 나머지 46개는 메타데이터 조회 성공.
- 누락된 4개는 soft-deleted 보관 영역에서도 찾을 수 없었다. 다른 외부 백업·단말 원본까지
  조사한 것은 아니므로 절대적인 복구 불가로 단정하지 않는다. DB 문서를 지우거나 이미지를 대체하지 않았다.

## 실제 서버 통합 확인

합성 계정과 합성 이미지로 166개 확인을 통과했다. 기존 사용자 계정으로 로그인하거나
기존 문서 원본을 다운로드하지 않았다. 생성한 테스트 계정·문서·활성 GCS 객체는 정리했다.

- 회원가입·이메일 로그인·사용자 조회·14일 JWT.
- 실제 PaddleOCR 엔진으로 네 문서 유형의 텍스트 블록 인식.
- Spring 경유 스캔·커밋, GCS 원본 생성, 문서 저장·조회.
- 소유자 이미지 접근 성공, 타 계정 조회·첨부 거부, 익명 접근 거부.
- 일반 사용자 JWT로 OCR 직접 호출 불가, 무인증 OCR 업로드·조회·삭제 불가.
- 네 유형 개별 삭제, 전체 문서 삭제, 미연결 업로드 정리, 탈퇴 및 다른 계정 이미지 보존.
- Spring 리비전 교체 후 동일 JWT·문서·GCS 이미지 조회 성공.
- Google·Kakao·Naver 인가 URL, 고정 콜백, state, 보안 쿠키, 누락 state 거부.
- OAuth 제공자의 실제 로그인 완료·앱 복귀는 실기기 검증이 필요하다.
- `/auth/me`의 탈퇴 계정 응답은 기존 계약상 400일 수 있으며 앱은 세션 만료로 처리한다.

새 Spring 초기 로그 221건, 최종 Spring 리비전 56건, OCR 리비전 257건 범위에서는
ERROR와 JWT·이메일 형태의 값이 발견되지 않았다.
이는 전체 로그·플랫폼 요청 URL·과거 기록에 민감정보가 없다는 보장은 아니다.
최종 OCR `/health`는 실제 인식 성공(`ocr: ok`)을 반환했다.

## 앱 산출물

| 항목 | 값 |
|---|---|
| 패키지 | `com.thegallery.mora` |
| versionName / versionCode | `0.1.0` / `9` |
| AAB | `mora-mobile-production-20261104.aab`, 100,202,666 bytes |
| APK | `mora-mobile-production-20261104.apk`, 151,506,362 bytes |
| AAB SHA-256 | `7aa4cc28610aa903910e0d45f3ccb1fe99d628640b7ad597134f0408d0a39ad6` |
| APK SHA-256 | `e1d109b487f49e87c41862e7b3ad7cff69a4b733ff850a48ffe66c1edc812416` |
| 서명 | 기존 2026-08-20 AAB와 같은 업로드 인증서, APK 서명 검증 성공 |
| 내용 일치 | AAB와 APK의 JavaScript 번들 해시 일치 |
| Android SDK | 최소 API 26, target API 36 |
| 권한 | 광범위 사진·동영상·외부 저장소·마이크·개발 오버레이 권한 없음 |
| 16 KB | AAB 정렬 설정 `PAGE_ALIGNMENT_16K`, arm64·x86_64 각 31개 ELF 정렬 검사 통과, APK zipalign 통과 |

로컬 EAS production 빌드로 versionCode를 8에서 9로 올리고 AAB를 생성했다.
같은 임시 네이티브 프로젝트·소스·버전·자격증명으로 APK를 만들었다.
bundletool validate, TypeScript, 린트, 앱 회귀 테스트 21개도 통과했다.
16 KB 단말에서 실제 앱을 실행한 것은 아니다. 연결된 에뮬레이터·기기가 없어 UI·촬영 테스트는 수행하지 않았다.

Play에서 설치한 앱의 최종 서명 키는 업로드 키와 다를 수 있다. 직접 APK 설치에서 서명 충돌이
발생하면 기존 앱을 자동 삭제하지 말고 Play 내부 테스트 업데이트를 우선 사용한다.

## 추가 공개 출시 보완 항목

후속 의존성 수정과 잔여 빌드 도구 경고는 [의존성 보안 보완 기록](Dependency%20Security%202026-11-04.md)을 참고한다.
아래 수치는 기존 versionCode 9 빌드 시점의 기록이다.

`npm audit --omit=dev`에서 경고 29개(critical 1 / high 14 / moderate 12 / low 2)를 확인했다.
이는 상위 패키지로 전파된 경고를 포함한 개수이며, 독립적인 취약점 29개나 확인된 공격 29건이라는 뜻은 아니다.
Expo 의존성에는 빌드 도구도 포함되어 있어 실제 앱 런타임 도달 여부를 구분해야 한다.

- `shell-quote`: critical 경고. [공식 보안 공지](https://github.com/advisories/GHSA-pqg4-j6r4-53mv).
- `decode-uri-component` → `query-string` → `expo-router`: 앱의 URL 처리 경로 영향 검토 필요.
  [공식 보안 공지](https://github.com/advisories/GHSA-qr28-fpjm-wq7f).
- `zod`: 앱 직접 의존성과 Expo 도구 의존성 모두 확인 필요.
  [공식 보안 공지](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
- 나머지 XML·이미지 크기·YAML·source map 등 경고도 업데이트와 빌드 도구 영향 범위를 검토해야 한다.
- 일부 자동 수정 제안이 Expo 51로의 SDK 변경을 제시하므로 `npm audit fix --force`는 적용하지 않았다.
- 이번 빌드의 잠금 파일·SDK는 변경하지 않았다. 내부 테스트를 먼저 진행할 수 있으나,
  공개 출시 전 호환성을 유지하는 업데이트·재검증·필요 시 새 버전 빌드가 필요하다.

## 사용자 다음 작업

1. Play Console의 기존 앱 → 테스트 → 내부 테스트 → 새 버전에 이번 AAB를 업로드한다.
2. 실제 표기에 맞춰 출시명을 `0.1.0 (9)`로 설정하고 내부 테스트 트랙에 배포한다. 프로덕션은 아직 제출하지 않는다.
3. 기존 테스터는 같은 참여 링크를 사용하고 Play에서 앱을 업데이트한다. 구버전 앱의 직접 OCR 호출·이미지 접근은 차단된다.
4. 실기기에서 네 유형 각각 촬영과 사진 선택 → 인식 → 저장 → 홈·보관함·상세 이미지 → 수정·삭제를 확인한다.
5. 소셜 로그인 3종의 실제 로그인 완료·취소·앱 복귀, 앱 종료 후 세션 유지, 전체 삭제·탈퇴를 확인한다.
6. 공개 출시 전 의존성 보안 보완과 개인정보·삭제 요청 URL·Data safety 정합성을 마무리한다.

## 빌드 추적

- Spring Cloud Build: `3d59a721-34ab-48bd-a047-dc5e045635a6`, SUCCESS.
- OCR Cloud Build: `ec137b7a-e819-431e-b423-ed5f073351a6`, SUCCESS.
- Spring digest: `sha256:005d45a72f5b6c1cc8b1881d53883118f8831938bdd3c92b9185eede597073ff`.
- OCR digest: `sha256:d5b3b598698e837c15fa3633d6f3bce4cf266fda21bbf7418199cf7a9c1e7e55`.
- 새 버전은 보안 계약이 달라 구버전 서버만 단독 롤백하거나 구버전 앱만 재배포하지 않는다.
