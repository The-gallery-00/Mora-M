# 첫 출시 범위와 앱 사전 검증

## 결정 (2026-11-04)

운영자가 첫 출시에서는 미완성 Google Calendar 연결과 AI 챗봇 진입점을 숨기고,
기능 완성 후 다시 추가하기로 결정했다. 구현 파일은 삭제하지 않는다.

- 기준: `origin/dev`의 `548308b` (출시 보안 PR #47 머지).
- 작업 브랜치: `feature/release-app-readiness`.
- 노출 조건: `src/config/releaseFeatures.ts`의 `aiChat`, `googleCalendar`는 모두 `false`.
- 검색 화면의 챗봇 버튼은 표시하지 않는다. `/chat` 직접 진입도 검색 탭으로 돌려보낸다.
- 설정의 Google Calendar 연결 섹션은 표시하지 않는다.
- 연결 상태·계정 정보 자동 조회와 과거 연결 콜백에 따른 재조회도 중단한다.
- 과거 빌드의 `EXPO_PUBLIC_CALENDAR_DEEPLINK=1` 설정만으로 다시 활성화되지 않는다.

유지하는 기능은 문서 OCR 등록·보관함·검색·앱 내부 알림과 문서 기반 일정이다.
캘린더 탭과 홈의 일정은 티켓·포스터의 날짜로 구성하며, 외부 Google Calendar와 별개다.
기능을 숨긴 것은 Google·Kakao·Naver 소셜 로그인을 숨기거나 사용자의 Google 계정 권한을
외부에서 철회한 것이 아니다. 기존 저장 데이터도 이 변경으로 삭제하지 않는다.

## 사진 선택과 코드 품질

- 앨범 접근 권한을 선요청하지 않고 시스템 단일 사진 선택기를 연다.
- 이미지 1장, 편집 끔, `legacy: false`, EXIF 제외 설정을 사용한다.
- 촬영용 카메라 권한 요청은 유지하며 앨범 선택과 분리한다.
- Android 설정에서 광범위 사진·동영상·외부 저장소 권한을 차단한다.
- 사용하지 않는 마이크 권한과 production의 개발 오버레이 권한도 차단한다.
- React 검사 규칙을 전역으로 끄지 않고 Reanimated 공유값을 `get()/set()`으로 변경했다.
- 폼 감시는 `useWatch`를 사용한다. 렌더 중 ref 접근과 저장 재시도 함수의 선언 전 참조를 정리했다.
- 포커스 스크롤 타이머는 교체·언마운트 시 해제한다. 분석 단계 라벨은 단계별로 초기화한다.

근거: [Expo ImagePicker](https://docs.expo.dev/versions/latest/sdk/imagepicker/),
[Expo 권한 설정](https://docs.expo.dev/guides/permissions/),
[Reanimated React Compiler 호환 접근](https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/).
실제 구현 판단에는 설치된 SDK 57 이미지 선택기와 Reanimated 4.5.1 소스도 확인했다.

## 확인한 결과

| 검사 | 결과 |
|---|---|
| TypeScript | `npm run typecheck` 통과 |
| 린트 | `npm run lint -- --no-cache`, 오류 0 / 경고 0 |
| 앱 보안·출시 범위 회귀 검사 | `npm run test:release`, 21개 통과 |
| Android production JS 번들 | Expo export 성공 |
| production native 설정 | 별도 임시 프로젝트에서 prebuild 성공 |
| 라이브러리 포함 매니페스트 병합 | `:app:processReleaseMainManifest` 성공 |
| 병합 결과의 패키지 | `com.thegallery.mora` |
| 병합 결과의 권한 | 사진·동영상 전체 접근, 외부 저장소, 마이크, 오버레이 권한 없음 |

Node 회귀 검사는 네이티브 런타임을 대체하며 화면 진입·피커 계약·조회 조건·소유권 전달을 검사한다.
단말에서 실제 선택기·카메라·제스처를 실행한 테스트는 아니다.
매니페스트 검사는 서명 APK/AAB 생성이나 Play Console의 최종 권한 판정을 대신하지 않는다.

## 다음 배포 단계

이 작업에서는 서버 재배포, 운영 DB 마이그레이션, 새 APK/AAB 생성·업로드를 하지 않았다.
읽기 전용 확인 시 운영 리비전은 아래 값이었다.

- Spring: `mora-mobile-spring-00021-hzt`.
- OCR: `mora-mobile-ocr-00008-qgx`.

1. 이번 앱 변경을 리뷰하고 `dev`에 머지한다.
2. [출시 보안 변경](../../server/RELEASE_SECURITY.md)에 따라 DB 백업·V8/V9 이전 데이터 검사와
   OCR 전용 Secret Manager 설정을 준비한다. 기존 JWT·OAuth 비밀정보를 덮어쓰지 않는다.
3. 새 앱과 두 서버를 함께 검증하고 운영 전환한다. 구버전 앱은 인증된 이미지 경로와 호환되지 않는다.
4. 최종 APK/AAB에서 권한을 다시 확인하고 실제 단말에서 촬영·사진 선택·인식·저장·이미지 조회를 검사한다.
5. 자르기·회전·핀치 확대·스와이프·분석 재시도·폼 수정·토스트와 소셜 로그인 3종도 확인한다.
6. 이후 정책·스토어 단계에서 스토어 설명과 스크린샷의 챗봇·외부 캘린더 제공 약속을 제거하고,
   개인정보처리방침·Data safety를 실제 수집·저장·전송·보관 기간과 맞춘다.

의미 검색의 외부 AI 키 미설정, 영수증 품목 추출, 기기 푸시, 기존 문서 일정 조회의 100건 상한은
완성된 기능으로 판정하지 않았다. 별도 개선 대상으로 남기며 출시 설명에 제공을 약속하지 않는다.
