# 스캔 내비게이션 내부 테스트 빌드 (2026-11-11)

## 기준과 범위

- 소스: `dev`의 `5dd8d1f05aa7f81224a12eb1ceed333b6cc006cc` (PR #51 머지).
- 빌드 종료 후 다시 fetch한 `origin/dev`도 같은 커밋이다.
- 앱 관련 소스·설정·에셋·잠금 파일 239개를 임시 빌드 폴더와 해시 비교해 일치를 확인했다.
- 기록 브랜치: `chore/scan-navigation-internal-build`. 앱 코드는 추가 변경하지 않았다.
- Spring/OCR/DB는 변경하지 않았고 서버 재배포도 하지 않았다.
- Play 업로드·내부 테스트 출시·공개 출시는 수행하지 않았다.

## 산출물

파일은 저장소 루트에 있으며 바이너리는 Git에 커밋하지 않는다.

| 항목 | 결과 |
|---|---|
| 패키지 | `com.thegallery.mora` |
| versionName / versionCode | `0.1.0` / `11` |
| AAB | `mora-mobile-navigation-v11-20261111.aab`, 100,402,496 bytes |
| APK | `mora-mobile-navigation-v11-20261111.apk`, 151,807,878 bytes |
| AAB SHA-256 | `899b4ef416dd433f073d957dada3801819afeebeac430ed5a4e7fe87937181bf` |
| APK SHA-256 | `90c13b86657f3c89f1121cd6be94e62e0b514aa81d914b47025cf6c7a0cd3c7a` |
| 공통 JS 번들 SHA-256 | `4c6f61415de6a3fd63f1d3d88338353f22ebe4b1fdfc3c3d2777e7f6996e535f` |

로컬 EAS production 빌드에서 원격 버전 코드를 10에서 11로 한 번만 증가시켰다.
AAB 생성 후 동일 임시 프로젝트에서 `:app:assembleRelease --offline`을 실행하여 APK를 만들었다.
Gradle의 AAB 빌드는 3분 36초, APK 빌드는 34초에 성공했다. 준비·검증 시간은 별도다.

## 검증 결과

- 회귀 테스트 61개, 타입 검사, 린트 통과. 린트 오류·경고 없음.
- bundletool 1.18.3의 AAB validate, jarsigner, APK apksigner, ZIP 무결성 검사 통과.
- 기존 versionCode 10과 동일한 업로드 인증서이며 AAB와 APK의 인증서도 같다.
- 두 파일의 JS 번들이 바이트 단위로 동일하고, versionCode 10의 번들과는 다르다.
- 운영 Spring/OCR HTTPS 주소가 최종 번들에 포함된다.
- 최소 API 26, target API 36, AAB의 cleartext와 debuggable 비활성화 확인.
- 두 최종 매니페스트에 광범위 사진·동영상·저장소·마이크·개발 오버레이 권한 없음.
- AAB `PAGE_ALIGNMENT_16K`, arm64-v8a·x86_64 각 31개 ELF의 LOAD 정렬 검사 통과.
- APK `zipalign -c -P 16 4` 통과. 이는 정적 검사이며 16KB 기기에서의 실행 검증은 아니다.
- 산출물에 keystore·credentials.json이 없고, 빌드 후 임시 서명 키 사본과 credentials.json도 삭제했다.

Expo doctor는 21개 중 20개를 통과했다. 새 SDK 패치 권고로 버전 일치 검사 1개가 실패했다.
권고 대상은 expo 57.0.32, expo-build-properties 57.0.23, expo-constants 57.0.23,
expo-dev-client 57.0.21, expo-image-manipulator 57.0.22, expo-image-picker 57.0.21,
expo-notifications 57.0.25, expo-router 57.0.30, expo-splash-screen 57.0.11이다.
이번 빌드는 머지된 잠금 파일을 유지했다. 패치 갱신은 별도 변경과 회귀 검증으로 진행한다.
설치 시 npm 감사는 전체 20개(critical 0 / high 3 / moderate 14 / low 3)를 보고했다.
감사 경고가 모두 해소됐거나 네이티브 실행까지 검증됐다는 의미는 아니다.

연결된 Android 기기·에뮬레이터가 없어 실제 카메라·전환 애니메이션·검은 화면은 재현 검증하지 않았다.

## 내부 테스트 인계

1. Play Console의 기존 앱 내부 테스트에 위 AAB를 새 버전으로 업로드한다.
2. 출시명은 `0.1.0 (11) - 스캔 뒤로가기 개선`으로 작성할 수 있다.
3. 테스터는 기존 참여 링크로 업데이트하고 설치 버전 코드가 11인지 확인한다.
4. 촬영과 갤러리 각각 크롭에서 시스템 백을 두 번 누른다. 카메라를 거쳐 원래 탭으로 복귀해야 한다.
5. 같은 절차를 상단 취소·닫기로 반복한다. 검은 화면·중복 카메라가 없어야 한다.
6. OCR 결과 편집 중 이미지 확대 후 시스템 백은 확대만 닫고 편집 내용은 유지해야 한다.
7. 스캔 종료 후 문서 상세·알림·설정에서 백을 반복해 카메라로 재진입하지 않는지 확인한다.
8. 연속 스캔·분석 취소·저장·카메라 권한 거부 후 재진입도 확인한다.

상세 절차는 [스캔 뒤로가기 수정](Scan%20Back%20Navigation%202026-11-11.md)을 따른다.
직접 설치 APK와 Play 배포 앱의 서명이 다르면 자동으로 앱을 삭제하지 않는다.
기존 데이터 보존을 위해 Play 내부 테스트 업데이트를 우선한다.

### 출시 노트 예시

```text
촬영 및 사진 업로드 화면의 뒤로가기 동작을 개선했습니다.
OCR 결과 이미지 확대 후 돌아올 때 편집 내용이 유지되도록 수정했습니다.
스캔 종료 후 촬영 화면으로 반복 이동하는 문제를 수정했습니다.
문서 분석 취소와 연속 스캔의 안정성을 개선했습니다.
```
