# 앱 의존성 보안 보완 (2026-11-04)

## 범위

- 기준: `origin/dev`의 `4a19265`, 작업 브랜치 `feature/dependency-security-updates`.
- Expo SDK 57 안에서 보안 패치와 권장 네이티브 모듈 버전을 적용했다.
- Spring/OCR/DB/API 계약은 변경하지 않는다. 서버 재배포 대상이 아니다.
- 공개 출시 승인이나 실기기 테스트 완료 기록이 아니다. 다음 개인정보·스토어 점검 단계는 별도로 진행한다.

## 적용 내용

| 항목 | 이전 | 적용 |
|---|---|---|
| Expo | 57.0.9 | 57.0.31 |
| Expo Router | 57.0.9 | 57.0.29 |
| React Native | 0.86.2 | SDK 권장 0.86.3 |
| 앱 Zod | 4.4.3 | 4.6.7 |
| shell-quote | 1.10.0 | 1.12.0 |
| URL 디코더 | 0.2.2 | 공식 0.5.1 알고리즘의 CommonJS 호환 복사본 |

SDK가 권장하는 카메라·사진 선택·인증·Secure Store 등 네이티브 패치도 함께 맞췄다.
Expo의 설치 안내에 따라 `expo-image`, `expo-web-browser` 설정 플러그인을 명시했다.
동일 버전 범위의 XML·YAML·압축·source map·nanoid·인증서 처리 패키지도 잠금 파일에 갱신했다.
`npm audit fix --force`와 SDK 다운그레이드는 사용하지 않았다.

### URL 디코더 호환 처리

Router 57의 `query-string@7.1.3`은 함수가 반환되는 CommonJS `require()`를 사용하지만
수정된 `decode-uri-component@0.5.1`은 ESM-only다. 단순 버전 override는 호환되지 않는다.

- 공식 npm tarball의 소스를 `vendor/decode-uri-component`에 라이선스와 함께 포함했다.
- 실행 코드의 변경은 ESM 기본 export를 CommonJS로 바꾼 것뿐이다. 주석 문장부호는 ASCII로 정리했다.
- 해당 query-string 버전에만 override를 적용하고, 루트 로컬 의존성을 참조한다.
- 공식 소스를 동일하게 변환한 결과의 SHA-256과 테스트에서 비교한다.
- upstream Router가 수정된 디코더를 호환되는 방식으로 사용하면 로컬 복사본과 override를 제거한다.
- [공식 디코더 보안 공지](https://github.com/advisories/GHSA-qr28-fpjm-wq7f),
  [공식 저장소](https://github.com/SamVerschueren/decode-uri-component).

## 보안 감사 결과

2026-11-04 npm registry 감사 응답 기준이며 상위 패키지로 전파된 경고를 포함한 개수다.
독립된 공격 수나 확인된 침해 수가 아니다. 설치 옵션·공지 갱신에 따라 달라질 수 있다.

| `npm audit --omit=dev` | 이전 | 이후 |
|---|---|---|
| critical | 1 | 0 |
| high | 14 | 4 |
| moderate | 12 | 9 |
| low | 2 | 2 |
| 합계 | 29 | 15 |

개발 의존성까지 포함한 이후 전체 감사는 28개(critical 0 / high 4 / moderate 22 / low 2)다.
Expo가 빌드 도구를 일반 의존성으로 선언하므로 `--omit=dev`도 앱 실행 코드만을 뜻하지 않는다.

### 남은 경고와 보류 이유

| 실제 취약 패키지 | 사용 위치 / 남은 위험 | 보류 이유 |
|---|---|---|
| image-size 1.2.1, high | React Native CLI의 Metro가 저장소 이미지 에셋 처리 | 수정된 2.0.3으로 시험 교체하면 Metro의 파일 경로 호출이 실패했다. 회귀 테스트로 확인 후 되돌림 |
| Zod 3.25.76, high | Expo CLI 입력 검증 | 앱 Zod 4.6.7과 별개. CLI가 Zod 3 API에 의존하므로 전역 Zod 4 override를 적용하지 않음 |
| glob 13.0.6, moderate | Expo 설정·플러그인·fingerprint의 파일 탐색 | 지원 범위 안의 수정 버전 없음. 취소 이후 탐색이 지속될 위험이 남음 |
| minimatch 10.2.6, moderate | 위 빌드 도구의 패턴 매칭 | 수정된 메이저로 일괄 교체하지 않음. 개발용 ESLint에는 3.1.5도 존재 |
| deepmerge 4.3.1, low | Expo 앱 설정 병합 | 현재 지원 버전 범위 안의 수정 없음. 비신뢰 설정 입력의 prototype 오염 위험이 남음 |

high 4개에는 위 두 실제 패키지와 `@expo/cli`, `expo`의 전파 경고가 포함된다.
감사 경고를 숨기거나 해결된 것으로 처리하지 않았다. 공개 출시 판단 시 팀이 이 잔여 위험을
검토해야 하며, SDK/Metro의 호환 수정이 나오면 잠금 파일 갱신과 빌드를 재검증한다.
확인되지 않은 외부 이미지·설정·glob 패턴을 빌드 입력으로 받지 않고, 개발 서버를 공개 인터넷에 노출하지 않는다.

Android export source map에서 위 다섯 패키지와 CLI의 중첩 Zod는 발견되지 않았다.
CLI 소스 중 `/build/metro-require/require.js`는 번들 로더로 포함되므로 CLI 전체가 제외됐다고 주장하지 않는다.
앱 실행 번들에는 수정된 로컬 디코더와 루트 Zod 4만 포함되는 것을 확인했다.
이는 해당 JS 번들의 정적 확인이며 전체 네이티브 의존성에 취약점이 없다는 보장은 아니다.

## 검증

- `npm run typecheck`: 통과.
- `npm run lint`: 오류 0, 경고 0.
- `npm run test:release`: 29개 통과(기존 21 + 의존성 회귀 8).
- `npx expo install --check`: SDK 권장 버전 일치.
- `npx expo-doctor`: 21/21 통과.
- Android export 및 source map 생성: 통과.
- 새 테스트: 한글·OAuth 쿼리, 중복 파라미터, 잘못된 UTF-8, 두 DoS 재현 입력의 제한 시간 내 처리,
  공식 디코더 알고리즘 일치, 실제 Metro 에셋 처리, 실제 인증 폼과 React Hook Form resolver.
- EAS 임시 폴더의 `npm ci --include=dev`와 Expo 검사도 통과했다.
- 해당 임시 폴더에서 회귀 테스트 29개와 타입 검사도 다시 통과했다.

실기기에서 실제 소셜 로그인·촬영·사진 선택·알림을 다시 검증한 것은 아니다.
내부 테스트의 새 버전을 설치한 후 이 항목을 확인해야 한다.

## 앱 산출물 (2026-11-05 완료)

| 항목 | 결과 |
|---|---|
| 패키지 | `com.thegallery.mora` |
| versionName / versionCode | `0.1.0` / `10` |
| AAB | `mora-mobile-security-v10-20261105.aab`, 100,401,333 bytes |
| APK | `mora-mobile-security-v10-20261105.apk`, 151,806,082 bytes |
| AAB SHA-256 | `4e6ecaefa3c7c6413f1fa7b22e887ed06b0ea6a8df910f3e0cad10bb24b2bf70` |
| APK SHA-256 | `dc2d1c4f765941cbf0cbc2ed570ee897cf582e5fce63e70888239bd1921a4946` |
| 서명 | 기존 versionCode 9 AAB와 동일한 업로드 인증서, jarsigner / apksigner 통과 |
| 번들 일치 | AAB와 APK의 JS 번들 SHA-256 `a6af5919897239e249431d771caf9164bd56cfa8dd9d4e1ccdbb155f1f542842` |
| Android | 최소 API 26 / target API 36, production cleartext 차단 |
| 권한 | 최종 AAB에서도 광범위 사진·동영상·저장소·마이크·개발 오버레이 권한 없음 |
| 16 KB | AAB `PAGE_ALIGNMENT_16K`, arm64·x86_64 각 31개 ELF 정렬 검사 통과, APK zipalign 통과 |
| 기타 검증 | bundletool validate 통과, 두 운영 서버 URL 포함 확인 |

빌드 내용은 소스 커밋 `54876ca`와 일치한다. 변경된 앱 관련 파일 8개의 해시를 임시 빌드
폴더와 비교했다. 빌드 전 마지막으로 확인한 `origin/dev`는 여전히 `4a19265`였다.

로컬 EAS가 versionCode를 9에서 10으로 올리고 동일 업로드 키로 임시 프로젝트를 준비했다.
처음 실행한 EAS 빌드는 React Native 대용량 다운로드 지연으로 중단했고, 오프라인 재시도는
아티팩트 캐시 인덱스 부재로 실패했다. 공식 아티팩트를 검증해 캐시에 추가한 후 온라인
메타데이터 확인을 허용한 동일 프로젝트에서 `:app:bundleRelease :app:assembleRelease`가
3분 30초에 성공했다. 버전 번호를 두 번 증가시키거나 서명 키를 새로 만들지 않았다.

검증한 공식 `react-android-0.86.3-release.aar`의 SHA-256은
`59b66e453d8775a54df66a321c0d5002b98716d68c4bd9edb8e64d7110ff8d28`이며 Maven의
공식 `.sha256` 응답 및 Gradle module 메타데이터와 일치한다. 임의 빌드 바이너리로 대체하지 않았다.
빌드 후 임시 keystore 사본과 비밀번호가 담긴 `credentials.json`은 삭제했다.
Play 업로드·내부 테스트 출시·프로덕션 제출은 수행하지 않았다.

## 내부 테스트 인계

1. 이 브랜치를 `dev`로 PR 및 머지한다.
2. 이번 AAB는 Play Console의 **내부 테스트** 새 버전으로 올린다. 프로덕션 제출은 하지 않는다.
3. 기존 테스터는 같은 참여 링크에서 업데이트하고 버전 코드가 10인지 확인한다.
4. 우선 소셜 로그인 3종의 앱 복귀·취소, 일반 로그인과 재실행 후 유지, 카메라와 사진 선택을 확인한다.
5. 문서 유형별 OCR → 저장 → 이미지 조회·삭제, 알림·앱 재실행을 짧게 재검증한다.
6. 문제 없으면 다음 단계인 개인정보처리방침·계정 삭제 URL·Data safety 정합성 확인을 요청한다.

직접 설치 APK와 Play 앱의 서명이 다르면 기존 앱을 자동 삭제하지 않는다.
Play 내부 테스트 업데이트가 기존 데이터 보존에 우선되는 경로다.
