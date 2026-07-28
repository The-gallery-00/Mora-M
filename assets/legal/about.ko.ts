// assets/legal/about.ko.ts — 앱 정보 (SCR-30 `doc=about`)
//
// Navigation Map §7 딥링크 표가 `doc ∈ terms|privacy|licenses|about` 로 4종을 정의한다.
// Screen Specs SCR-30 문서 표에는 앞 3종만 적혀 있어 `about` 의 본문 규격이 없다 —
// 이 파일이 그 자리를 채운다.
//
// 다른 세 문서와 달리 **함수**다. 버전·빌드·프로파일은 런타임 값이라 상수 문자열에 박을 수 없고,
// 박아 두면 릴리스마다 문서를 고쳐야 한다(원본 웹이 `v1.2.3 (build 248)` 를 하드코딩해 두고
// 실제 버전과 어긋나 있던 것이 정확히 이 문제다 — SCR-25 변경점 표).
//
// `.md` 가 아니라 `.ts` 인 이유는 `terms.ko.ts` 상단 주석 참조.

export interface AboutContext {
  /** `app.config.js` 의 `version`. */
  version: string;
  /** Android `versionCode` 등 빌드 번호. 없으면 `-`. */
  build: string;
  /** `development` | `preview` | `production`. */
  variant: string;
}

export function aboutKo({ version, build, variant }: AboutContext): string {
  return `
MORA 는 명함·티켓·포스터·영수증을 촬영하면 문자를 인식해 항목별로 정리하고,
나중에 자연어로 다시 찾을 수 있게 해 주는 문서 정리 앱입니다.

## 버전 정보

| 항목 | 값 |
|---|---|
| 앱 버전 | ${version} |
| 빌드 | ${build} |
| 배포 프로파일 | ${variant} |

## 이 앱이 하는 일

- **스캔** — 카메라 또는 앨범의 이미지를 문서 4종으로 자동 분류하고 문자를 인식합니다.
- **보관함** — 인식 결과를 유형별로 모아 두고 명함첩으로 다시 묶을 수 있습니다.
- **검색** — 정확한 단어가 기억나지 않아도 의미가 비슷한 문서를 찾아 줍니다.
- **일정** — 티켓의 출발일과 포스터의 마감일을 달력과 알림으로 이어 줍니다.

## 알아 두실 점

- 문자 인식과 항목 추출은 자동 처리 결과이며 **정확성을 보증하지 않습니다.**
  금액·일시·연락처는 원본 이미지와 대조해 확인해 주세요.
- 기기 푸시 알림은 준비 중입니다. 현재 알림은 앱 안에서만 확인할 수 있습니다.

## 문의

- 이메일: support@mora.app
- 소스 저장소: https://github.com/lavermeanyou/OCR_FOR_MORA

---

© 2026 MORA. All rights reserved.
`.trim();
}
