# 안드로이드 홈 위젯

MORA 는 홈 화면 위젯 2종을 제공한다. 순수 **RemoteViews**(XML 레이아웃 + `AppWidgetProvider`)로
만들었고 새 gradle 플러그인·npm 패키지를 0개 추가한다. minSdk 26 전 구간에서 동작한다.

- 소스 정본: `widgets/android/`
- 주입 플러그인: `plugins/withMoraWidgets.js`
- RN 쪽 데이터 생성: `src/features/widget/`

---

## 1. 위젯 2종

### A. MORA 다가오는 일정 (`UpcomingWidgetProvider`)

가까운 일정을 D-day 와 함께 목록으로 보여준다.

| 크기 | 최소 높이 | 표시 항목 |
| --- | --- | --- |
| 4×2 (기본) | 110dp | 3개 |
| 4×3 | 180dp | 4개 |
| 4×4 | 250dp | 5개 |

행 개수는 **위젯을 리사이즈하는 순간** 다시 계산된다(`onAppWidgetOptionsChanged`).
RemoteViews 는 런타임에 뷰를 만들 수 없으므로 레이아웃에 5행을 미리 정의해 두고
남는 행을 `GONE` 으로 접는다.

한 행의 구성:

- **D-day 배지** — `D-DAY` / `D-3` …. 3일 이하는 마감색(`#B45309`), 그 이상은 포인트색(`#0077B6`).
- **제목** — 티켓은 `출발지 → 도착지`, 포스터는 문서 제목.
- **부제** — `18:00 · SRT` 처럼 시각 + 상세. 없으면 행에서 접힌다.
- **문서유형 색 점** — 명함/티켓/포스터/영수증/마감을 색으로 구분.

탭 동작:

| 누른 곳 | 이동 |
| --- | --- |
| 항목 | `mora://doc/{card\|ticket\|poster\|receipt}/{id}` (문서 상세) |
| 헤더 | `mora://` (앱 홈) |
| ↻ | 위젯만 즉시 다시 그린다(파일 재읽기). **30분 주기를 기다리지 않는 유일한 수단이다.** |
| 빈 상태 | `mora://scan` |

데이터가 없으면 **"스캔해서 일정을 등록하세요"** 를 띄우고, 누르면 스캔 화면이 열린다.

### B. MORA 달력 (`CalendarWidgetProvider`)

4×4 월간 달력. 6주 × 7일 = **42칸**을 XML 에 미리 정의해 두고
`setTextViewText` / `setTextColor` / `setViewVisibility` / `setBackgroundResource` 로만 채운다
(RemoteViews 에서는 동적 그리드를 만들 수 없다).

- 헤더 `2026년 7월` + 좌우 이동 버튼 `◀ ▶`
- **오늘** 은 원으로 강조(흰 숫자)
- 일정이 있는 날은 숫자 아래 **점** 표시
- 일요일 빨강(`#DC2626`) / 토요일 파랑(`#2563EB`) / 이번 달 아닌 날 회색

탭 동작:

| 누른 곳 | 동작 |
| --- | --- |
| 날짜 | `mora://calendar?date=YYYY-MM-DD` |
| ◀ ▶ | 위젯 내부 상태로 월 이동(앱을 열지 않는다) |
| 월 라벨 | 이번 달로 복귀 + 파일 재읽기 |

월 이동은 절대 월("2026-07")이 아니라 **이번 달로부터의 offset** 을 위젯 id 별로
`SharedPreferences` 에 저장한다. 달이 바뀌어도 offset 0 이 자동으로 '이번 달'을 가리켜
위젯이 과거에 멈추지 않는다. 범위는 ±120개월로 제한한다.

위젯은 앱의 다크모드 동결과 무관하게 **라이트 고정**이다. 색은 `src/theme/tokens.ts` 의
light 팔레트를 `res/values/widget_colors.xml` 과 `WidgetTheme.kt` 에 복제한 값이다
(위젯은 RN 밖이라 NativeWind 가 닿지 않는다). **정본은 언제나 `tokens.ts` 다** — 바뀌면 세 곳을 함께 고친다.

---

## 2. 추가하는 방법

1. 홈 화면의 **빈 공간을 길게 누른다**.
2. 나타나는 메뉴에서 **위젯**(Widgets)을 탭한다.
3. 앱 목록에서 **MORA** 를 찾는다.
4. **MORA 다가오는 일정** 또는 **MORA 달력** 을 길게 눌러 홈 화면으로 끌어다 놓는다.
5. 놓은 뒤 테두리를 드래그해 크기를 조절할 수 있다(다가오는 일정은 높이에 따라 3~5개).

> 개발 빌드(`com.mora.app.dev`)를 설치했다면 위젯 선택기에서 앱 이름이 **MORA (dev)** 로 보인다.
> dev 와 preview/production 은 서로 다른 앱이라 위젯도 각각 따로 존재한다.

---

## 3. 데이터가 흐르는 길

네이티브 모듈을 만들지 않았다. 브리지는 **JSON 파일 한 장**이다.

```
RN (앱 실행 중)                                    Android (런처 프로세스)
─────────────────────────                          ────────────────────────
useWidgetSync()
  React Query 캐시를 읽어
  buildWidgetPayload()
        │
        ▼
  expo-file-system
  documentDirectory/widget-data.json   ────────▶   File(context.filesDir,
                                                       "widget-data.json")
                                                          │
                                                          ▼
                                                   WidgetData.load()
                                                          │
                                                          ▼
                                                   RemoteViews 갱신
```

### 경로 매핑 (실측 확인)

`expo-file-system` 의 `documentDirectory` 는 안드로이드에서 `context.filesDir` 와
**정확히 같은 디렉토리**다. node_modules 원본을 따라가 확인한 사슬:

```
expo-file-system/android/.../FileSystemModule.kt
  Constant("documentDirectory") { Uri.fromFile(filesDirectory) + "/" }
  private val filesDirectory get() = appContext.persistentFilesDirectory
expo-modules-core/.../AppContext.kt
  val persistentFilesDirectory get() = appDirectories.persistentFilesDirectory
expo-modules-core/.../services/AppDirectoriesService.kt
  open val persistentFilesDirectory: File get() = context.filesDir   ← 종점
```

`AppDirectoriesService` 는 `open` 이지만 이 프로젝트 node_modules 어디에도 서브클래스가 없다
(expo-updates / dev-client 포함 전수 검색). 즉 development·preview·production 전부 같다.
**별도 경로 상수가 필요 없다.** 변형별 실제 경로:

```
development  : /data/user/0/com.mora.app.dev/files/widget-data.json
preview·prod : /data/user/0/com.mora.app/files/widget-data.json
```

### 갱신 트리거

**RN → 파일** (`useWidgetSync`, 1.2초 디바운스):

1. 앱 마운트 직후 1회
2. `['dashboard', …]` 쿼리 캐시 갱신 시 — **문서 저장·삭제가 여기 포함된다**
   (뮤테이션이 `['dashboard']` 를 무효화하고 그 재요청 성공이 리스너를 발화시킨다)
3. 앱 포그라운드 복귀

이 훅은 **읽기만 한다.** `useDashboard()` 를 직접 호출하지 않는다 — 그러면 루트에 옵저버가
하나 더 붙어 앱 실행마다 티켓·포스터를 추가로 내려받게 되고, 로그아웃 상태에서도 요청이 나간다.
캐시가 완전히 비어 있으면 **아무것도 쓰지 않고 기존 파일을 남긴다**(빈 값으로 덮으면
사용자에게는 "일정이 사라졌다"로 보인다).

**파일 → 위젯**:

- `updatePeriodMillis = 1800000` (30분)
- 위젯 탭(↻ / 월 라벨 / ◀ ▶)
- 부팅 후 (시스템이 `APPWIDGET_UPDATE` 를 다시 스케줄한다 — `BOOT_COMPLETED` 수신 권한이 필요 없다)

### ⚠ 30분 지연 — 알려진 한계

**앱에서 문서를 저장해도 위젯에는 최대 30분 뒤에 반영된다.**

`updatePeriodMillis` 의 30분은 안드로이드가 허용하는 **최소값**이다. 더 짧게 적으면 무시되고,
절전 상태에서는 30분보다 더 늦게 올 수도 있다.

RN 이 파일을 쓴 직후 런처에 "지금 다시 그려라"를 알리려면 `AppWidgetManager` 를 호출하는
**네이티브 모듈이 필요하고, v1 에서는 만들지 않았다.** 일정과 날짜는 분 단위로 바뀌지 않으므로
수용 가능한 지연이라고 판단했다.

**즉시 보고 싶으면 위젯 헤더의 ↻ 를 누른다.** 그 자리에서 파일을 다시 읽어 그린다.

### 앱을 한 번도 실행하지 않으면 빈 상태인 이유

위젯이 읽는 `widget-data.json` 은 **RN 이 만든다.** 위젯 자신은 네트워크를 하지 않고
서버를 모른다 — 파일만 읽는다. 따라서:

- 앱 설치 직후 위젯을 먼저 놓으면 파일이 없어 **"스캔해서 일정을 등록하세요"** 가 뜬다.
- 앱을 한 번 실행해 홈이나 캘린더가 로드되면 파일이 생기고, 다음 갱신에 내용이 채워진다.
- **로그아웃·세션 만료 시 파일을 삭제한다**(`clearWidgetData`). 지우지 않으면 로그아웃 뒤에도,
  심지어 다른 사람이 폰을 쥐어도 홈 화면에 이전 사용자의 일정 제목·장소가 그대로 남는다.

> `AndroidManifest.xml` 의 `android:allowBackup="true"` 때문에 이 파일은 구글 백업 대상이다.
> 일정 제목·장소가 백업에 실린다. 민감하다고 판단되면 `dataExtractionRules` 에
> `<exclude domain="file" path="widget-data.json"/>` 를 추가해야 한다.

---

## 4. 소스는 왜 `widgets/` 에 있는가

```
widgets/android/src/main/
├── java/com/mora/app/widget/*.kt        위젯 로직 (6개)
└── res/
    ├── layout/widget_{upcoming,calendar}.xml
    ├── xml/widget_{upcoming,calendar}_info.xml   appwidget-provider 메타
    ├── drawable/widget_*.xml
    └── values/widget_{colors,strings}.xml
plugins/withMoraWidgets.js                config plugin
```

**`android/` 는 `.gitignore` 대상이고 `expo prebuild` 가 통째로 다시 만든다.**
거기에 Kotlin·XML 을 직접 넣으면 커밋되지 않고 다음 prebuild 에 사라진다.
그래서 정본은 `widgets/` 에 두고(= 커밋 대상) 플러그인이 prebuild 때
`android/app/src/main/` 으로 복사한다.

> **위젯을 고칠 때는 항상 `widgets/` 쪽을 고친다.** `android/` 를 고치면 잃는다.

플러그인이 하는 일은 3가지뿐이다:

1. `widgets/android/src/main/` → `android/app/src/main/` 복사 (멱등, 병합)
2. `AndroidManifest.xml` 의 `<application>` 안에 `<receiver>` 2개 추가 (멱등)
3. 위젯 라벨 문자열이 없으면 폴백 생성 (미완성 상태에서도 빌드가 깨지지 않게)

### 파일명 규약 (어기면 앱이 깨진다)

prebuild 된 `res/values/` 에는 앱이 쓰는 `strings.xml`(런처 이름) · `colors.xml`(스플래시·알림 색) ·
`styles.xml`(`AppTheme`) 이 이미 있다. 위젯 트리에 같은 이름의 파일을 두면 복사가 이것들을
**통째로 덮어쓴다.** 플러그인의 `PROTECTED_PATHS` 가 그 3개 + `AndroidManifest.xml` 을
복사 대상에서 제외하고 경고를 찍지만, 애초에 그러지 마라.

- ✅ `res/values/widget_strings.xml`, `res/values/widget_colors.xml`
- ❌ `res/values/strings.xml`, `res/values/colors.xml`, `res/values/styles.xml`

리소스 **이름**에도 `widget_` 접두사를 붙인다. 같은 `values` 폴더에서 이름이 겹치면
AGP 가 "Duplicate resources" 로 빌드를 멈춘다.

### 왜 Glance/Compose 가 아닌가

이 프로젝트의 gradle 버전은 `expo-root-project` 플러그인이 통제하고 `android/build.gradle` 에
명시 버전이 없다. Compose 컴파일러 플러그인·BOM 을 끼우면 **기존 RN 0.86 빌드가 깨질 위험**이 크다.
RemoteViews 는 새 gradle 플러그인 0개로 끝난다.

### 왜 `import com.mora.app.R` 이 없는가

`expo prebuild` 는 `android/app/build.gradle` 의 `namespace` 를 app.config.js 의
`android.package` 로 덮어쓴다. 그래서 변형마다 R 클래스 위치가 갈린다:

```
development  → namespace com.mora.app.dev  → com.mora.app.dev.R
preview/prod → namespace com.mora.app      → com.mora.app.R
```

소스에 어느 한쪽을 하드코딩하면 **다른 변형의 빌드가 컴파일 단계에서 깨진다.**
그래서 `WidgetRes.kt` 가 `Resources.getIdentifier` 로 이름 조회를 하고 결과를 캐시한다.
못 찾으면 0 을 돌려주고 확장 함수들이 조용히 무시한다 — provider 에서 예외가 나가면
런처에 "위젯을 로드할 수 없음"이 남기 때문이다.

같은 이유로 **매니페스트의 `<receiver android:name>` 은 풀네임으로 박는다.**
`.widget.Xxx` 상대 표기는 namespace 기준으로 풀려서 dev 변형에서
`com.mora.app.dev.widget.Xxx`(존재하지 않는 클래스)가 된다. 매니페스트의 클래스명은
빌드 시점에 검증되지 않으므로 이 실수는 **컴파일을 통과하고 dev 에서만 런타임에 깨진다.**

---

## 5. 후속 과제

- **즉시 갱신용 네이티브 모듈.** `AppWidgetManager.updateAppWidget` 을 RN 에서 부를 수 있게 하면
  30분 지연이 사라진다. Expo Modules API 로 `requestWidgetRefresh()` 하나만 노출하면 되고,
  파일 스키마는 그대로 쓸 수 있다. 현재는 ↻ 버튼이 유일한 즉시 갱신 수단이다.
- **`signOutLocal()` 커버리지.** 위젯 파일 삭제는 `registerSessionCleanup` 으로
  `authStore.signOut()` / `expireSession()` 두 경로를 덮는다. 완전한 커버리지는
  `signOutLocal()` 에 `clearWidgetData()` 한 줄을 넣는 것이다.
- **리소스 shrinking 을 켠다면 주의.** 색 점·배지·오늘 원 drawable 은 `getIdentifier` 로만
  참조되어 정적 참조가 0이다. 현재 `android.enableShrinkResourcesInReleaseBuilds` 는 기본 `false`
  라 안전하지만, 켤 때는 `res/raw/keep.xml` 에 `tools:keep` 로 `widget_dot_*`, `widget_badge_*`,
  `widget_today_circle` 을 보존해야 점과 배지가 조용히 사라지지 않는다.
- **위젯 미리보기 이미지.** `previewImage` 를 넣지 않았다. API 31+ 는 `previewLayout`(실제 레이아웃
  렌더)을 쓰고 그 이하 런처는 앱 아이콘으로 떨어진다. 구형 런처에서 선택기 미리보기를 예쁘게
  하려면 PNG 에셋이 필요하다.
