/**
 * withMoraWidgets — 안드로이드 홈 위젯(RemoteViews) 네이티브 소스 주입 config plugin.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  왜 플러그인이 필요한가
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `android/` 는 `.gitignore` 대상이고(`/android` 항목) `expo prebuild --clean` 이 통째로
 * 다시 만든다. 거기에 Kotlin·XML 을 직접 넣으면 **커밋되지 않고 다음 prebuild 에 사라진다.**
 * 그래서 정본은 `widgets/android/src/main/` 에 두고(= 커밋 대상) 이 플러그인이 prebuild 때
 * `android/app/src/main/` 으로 복사한다. 위젯 소스를 고칠 때는 **항상 widgets/ 쪽을 고쳐라.**
 *
 * Glance/Compose 를 쓰지 않는 이유도 같은 계열이다 — gradle 버전은 `expo-root-project`
 * 플러그인이 통제하고 `android/build.gradle` 에 명시 버전이 없어서, Compose 컴파일러
 * 플러그인·BOM 을 끼우면 RN 0.86 빌드가 깨질 위험이 크다. 이 플러그인은 **새 gradle 플러그인을
 * 0개 추가한다.** 순수 RemoteViews(XML 레이아웃 + AppWidgetProvider) 라 minSdk 26 에서 전부 된다.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  이 플러그인이 하는 일 (딱 3가지)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  1. `widgets/android/src/main/` 전체를 `android/app/src/main/` 으로 복사(덮어쓰기, 멱등).
 *  2. `AndroidManifest.xml` 의 `<application>` 안에 `<receiver>` 2개 추가(멱등).
 *  3. 위젯 라벨 문자열이 없으면 폴백 `widget_strings.xml` 을 생성(빌드 실패 방지).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠ 위젯 소스 작성자에게 — 파일명 규약 (어기면 앱이 깨진다)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * prebuild 된 `android/app/src/main/res/values/` 에는 이미 **앱이 쓰는 3개 파일**이 있다:
 *   - `strings.xml`  → `app_name` (런처 이름)
 *   - `colors.xml`   → `notification_icon_color`, `splashscreenBackground`
 *   - `styles.xml`   → `AppTheme`
 * 위젯 트리에 같은 이름의 파일을 두면 복사가 이 파일들을 **통째로 덮어써** 런처 이름과
 * 스플래시·알림 색이 사라진다. 그래서 아래 `PROTECTED_PATHS` 가 그 3개 + AndroidManifest 를
 * **복사 대상에서 제외하고 경고를 찍는다.**
 *
 *   ✅ 써라: `res/values/widget_strings.xml`, `res/values/widget_colors.xml`
 *   ❌ 쓰지 마라: `res/values/strings.xml`, `res/values/colors.xml`, `res/values/styles.xml`
 *
 * 리소스 이름도 `widget_` 접두사를 붙여라 — 같은 `values` 폴더 안에서 이름이 겹치면
 * AGP 가 "Duplicate resources" 로 빌드를 멈춘다.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  네임스페이스 / 액션 이름
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ receiver 의 `android:name` 은 **풀네임으로 박는다**(`.widget.Xxx` 상대 표기 금지).
 *
 * `expo prebuild` 는 `android/app/build.gradle` 의 `namespace` 를 app.config.js 의
 * `android.package` 로 덮어쓴다. 그래서 변형마다 namespace 가 갈린다:
 *   development  → namespace `com.mora.app.dev`
 *   preview/prod → namespace `com.mora.app`
 * 매니페스트의 상대 클래스명은 **namespace 기준**으로 풀리므로 `.widget.UpcomingWidgetProvider` 는
 * dev 에서 `com.mora.app.dev.widget.UpcomingWidgetProvider` 가 된다 — 그런 클래스는 없다
 * (Kotlin 의 package 는 변형과 무관하게 `com.mora.app.widget` 로 고정이다).
 *
 * 이게 고약한 이유: **컴파일과 리소스 링크는 그대로 통과한다.** 매니페스트의 클래스명은
 * 빌드 시점에 검증되지 않아서, preview/prod 는 우연히 맞고 dev 만 조용히 깨진다. 증상은
 * 위젯을 홈에 놓는 순간 런처에 "위젯을 로드할 수 없음"(ClassNotFoundException) 이 뜨는 것이다.
 * → 아래 [WIDGET_PACKAGE] 로 풀네임을 만들어 namespace 에서 완전히 분리한다.
 *
 * 월 이동 브로드캐스트 액션은 `com.mora.app.widget.ACTION_MONTH_SHIFT` 로 **고정**이다.
 * 위젯 Kotlin 쪽 상수와 문자 단위로 같아야 한다. receiver 가 `exported="false"` 라
 * 우리 앱만 보낼 수 있고, dev/preview 는 서로 다른 앱이라 액션 문자열이 같아도 충돌하지 않는다.
 */

const { AndroidConfig, createRunOncePlugin, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const TAG = '[withMoraWidgets]';

/** 위젯 네이티브 소스 정본 위치 (프로젝트 루트 기준). */
const SOURCE_REL = path.join('widgets', 'android', 'src', 'main');

/**
 * 위젯 Kotlin 의 package. **변형(dev/preview/prod)과 무관하게 고정**이다 —
 * 위 "네임스페이스" 주석 참조. 소스 경로와 매니페스트 클래스명을 둘 다 여기서 유도해
 * 한쪽만 바뀌는 사고를 막는다.
 */
const WIDGET_PACKAGE = 'com.mora.app.widget';

/** `com.mora.app.widget` → `['com','mora','app','widget']` (소스 트리 경로 세그먼트). */
const WIDGET_PACKAGE_SEGMENTS = WIDGET_PACKAGE.split('.');

/**
 * 복사에서 제외하는 경로 (POSIX 구분자로 비교한다).
 * 이유는 파일 상단 "파일명 규약" 참조 — 앱 리소스를 덮어쓰는 사고를 원천 차단한다.
 */
const PROTECTED_PATHS = new Set([
  'AndroidManifest.xml',
  'res/values/strings.xml',
  'res/values/colors.xml',
  'res/values/styles.xml',
]);

const APPWIDGET_UPDATE = 'android.appwidget.action.APPWIDGET_UPDATE';

/**
 * 위젯이 자기 자신에게 보내는 자체 브로드캐스트 액션들.
 * 위젯 Kotlin 의 `const val ACTION_*` 과 **문자 단위로 같아야 한다**:
 *   CalendarWidgetProvider.ACTION_MONTH_SHIFT / ACTION_REFRESH
 *   UpcomingWidgetProvider.ACTION_REFRESH
 *
 * ⚠ 이 액션들은 `WidgetLinks.kt` 가 `component = ComponentName(...)` 로 **명시적 인텐트**로
 *   보내므로 사실 intent-filter 가 없어도 전달된다. 그래도 등재하는 이유는 두 가지다:
 *   (1) 매니페스트가 위젯↔플러그인 계약을 드러내는 문서 역할을 한다,
 *   (2) 나중에 누군가 암시적 전송으로 바꿔도 조용히 깨지지 않는다.
 *   receiver 가 `exported="false"` 라 등재해도 외부 앱은 이 액션으로 우리를 깨울 수 없다.
 */
const ACTION_MONTH_SHIFT = 'com.mora.app.widget.ACTION_MONTH_SHIFT';
const ACTION_REFRESH_CALENDAR = 'com.mora.app.widget.ACTION_REFRESH_CALENDAR';
const ACTION_REFRESH_UPCOMING = 'com.mora.app.widget.ACTION_REFRESH_UPCOMING';

/**
 * 추가할 receiver 2개.
 *
 * `exported: false` — 런처(SystemUI)가 보내는 `APPWIDGET_UPDATE` 는 시스템 특권으로 전달되므로
 * exported 가 필요 없다. 월 이동도 우리 앱이 자기 자신에게 보내는 explicit intent 다.
 * true 로 두면 아무 앱이나 위젯 갱신을 트리거할 수 있어 그럴 이유가 없다.
 */
const RECEIVERS = [
  {
    name: `${WIDGET_PACKAGE}.UpcomingWidgetProvider`,
    label: '@string/widget_upcoming_label',
    info: '@xml/widget_upcoming_info',
    actions: [APPWIDGET_UPDATE, ACTION_REFRESH_UPCOMING],
  },
  {
    name: `${WIDGET_PACKAGE}.CalendarWidgetProvider`,
    label: '@string/widget_calendar_label',
    info: '@xml/widget_calendar_info',
    // 월 이동·새로고침을 같은 필터에 넣는다. 브로드캐스트 receiver 는 action 중 하나만
    // 맞으면 매칭되므로 필터를 쪼갤 이유가 없다.
    actions: [APPWIDGET_UPDATE, ACTION_MONTH_SHIFT, ACTION_REFRESH_CALENDAR],
  },
];

/**
 * 위젯 트리가 라벨 문자열을 주지 않았을 때만 쓰는 폴백.
 * 매니페스트가 `@string/widget_*_label` 을 참조하므로 이게 없으면 **빌드가 실패한다** —
 * 위젯이 미완성이어도 앱은 떠야 한다는 규칙(위젯은 순수 추가)을 지키기 위한 안전망이다.
 */
const FALLBACK_LABELS = {
  widget_upcoming_label: 'MORA 다가오는 일정',
  widget_calendar_label: 'MORA 달력',
};

// ───────────────────────────────────────────────────────── 1. 소스 복사

/**
 * `widgets/android/src/main/` → `android/app/src/main/`.
 *
 * `fs.cpSync(recursive)` 는 대상 디렉토리를 **병합**한다(기존 파일을 지우지 않는다).
 * 같은 경로 파일은 덮어쓰므로 재실행에 멱등이다.
 */
function withWidgetSources(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const source = path.join(cfg.modRequest.projectRoot, SOURCE_REL);
      const dest = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main');

      if (!fs.existsSync(source)) {
        // 위젯 소스가 아직 없는 브랜치/체크아웃에서도 prebuild 는 성공해야 한다.
        console.warn(`${TAG} ${SOURCE_REL} 이 없어 위젯 소스 복사를 건너뜁니다.`);
        return cfg;
      }

      fs.mkdirSync(dest, { recursive: true });
      fs.cpSync(source, dest, {
        recursive: true,
        force: true,
        filter: (from) => {
          const rel = path.relative(source, from).split(path.sep).join('/');
          if (rel !== '' && PROTECTED_PATHS.has(rel)) {
            console.warn(
              `${TAG} ${rel} 은 앱 리소스를 덮어쓰므로 복사하지 않았습니다. ` +
                `위젯 리소스는 widget_ 접두사 파일(예: res/values/widget_strings.xml)에 두세요.`,
            );
            return false;
          }
          return true;
        },
      });

      ensureWidgetLabels(dest);
      return cfg;
    },
  ]);
}

/**
 * `@string/widget_*_label` 이 어느 `res/values/*.xml` 에도 없으면 폴백 파일을 만든다.
 *
 * **이미 정의돼 있으면 아무것도 하지 않는다** — 같은 이름을 두 파일에 넣으면 AGP 가
 * "Duplicate resources" 로 빌드를 멈추기 때문이다. 그래서 `withStringsXml` 로 무조건
 * 주입하지 않고, 복사가 끝난 실제 상태를 보고 판단한다.
 */
function ensureWidgetLabels(destMain) {
  const valuesDir = path.join(destMain, 'res', 'values');
  const needed = Object.keys(FALLBACK_LABELS).filter((name) => !stringResourceExists(valuesDir, name));
  if (needed.length === 0) return;

  const body = needed.map((name) => `  <string name="${name}">${FALLBACK_LABELS[name]}</string>`).join('\n');
  fs.mkdirSync(valuesDir, { recursive: true });
  fs.writeFileSync(
    path.join(valuesDir, 'widget_labels_fallback.xml'),
    // 손으로 고치지 말라는 표시를 파일 안에 남긴다 — 이 파일은 매 prebuild 마다 재생성된다.
    `<?xml version="1.0" encoding="utf-8"?>\n<!-- withMoraWidgets 자동 생성. 정본은 widgets/android/src/main/res/values/widget_strings.xml -->\n<resources>\n${body}\n</resources>\n`,
    'utf8',
  );
  console.warn(`${TAG} 위젯 라벨 폴백을 생성했습니다: ${needed.join(', ')}`);
}

/** `res/values/*.xml` 전체에서 `<string name="...">` 존재 여부. 정규식으로 충분하다(생성물만 본다). */
function stringResourceExists(valuesDir, name) {
  if (!fs.existsSync(valuesDir)) return false;
  const pattern = new RegExp(`<string\\s[^>]*name\\s*=\\s*"${name}"`);
  return fs
    .readdirSync(valuesDir)
    .filter((file) => file.endsWith('.xml'))
    .some((file) => pattern.test(fs.readFileSync(path.join(valuesDir, file), 'utf8')));
}

// ───────────────────────────────────────────────── 2. 매니페스트 receiver

/**
 * `<application>` 안에 위젯 receiver 를 넣는다.
 *
 * 멱등 전략: 우리 `android:name` 을 가진 기존 항목을 **먼저 전부 걷어내고** 필요한 것만 다시
 * 추가한다. `있으면 skip` 으로 하면 정의를 고쳤을 때 옛 항목이 남고, 소스가 사라졌을 때
 * 죽은 receiver 가 매니페스트에 방치된다.
 */
function withWidgetReceivers(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const ours = new Set(RECEIVERS.map((receiver) => receiver.name));
    const existing = Array.isArray(application.receiver) ? application.receiver : [];

    application.receiver = [
      ...existing.filter((entry) => !ours.has(entry?.$?.['android:name'])),
      ...availableReceivers(cfg.modRequest.projectRoot).map(toManifestReceiver),
    ];

    return cfg;
  });
}

/**
 * 네이티브 소스가 **실제로 존재하는** receiver 만 고른다.
 *
 * 이 게이트가 없으면 위젯 Kotlin/XML 이 아직 없는 상태에서 매니페스트가
 * `@xml/widget_upcoming_info` 를 참조하고, AGP 가 리소스 링크 단계에서 **APK 빌드 전체를
 * 실패시킨다.** 위젯은 순수 추가여야 하고 미완성이어도 앱은 빌드·실행돼야 하므로
 * (위젯 담당과 병렬 작업 중이면 이 상태가 실제로 발생한다) 없는 것은 조용히 건너뛴다.
 *
 * 두 파일을 함께 본다:
 *  - `res/xml/<info>.xml`        → 없으면 **빌드 실패**(리소스 미해결)
 *  - `java/com/mora/app/widget/<Class>.kt` → 없으면 런처가 위젯을 붙일 때 ClassNotFound
 * 경로는 receiver 정의에서 기계적으로 유도하므로 규약(파일 상단)을 지키면 자동으로 맞는다.
 */
function availableReceivers(projectRoot) {
  const source = path.join(projectRoot, SOURCE_REL);

  return RECEIVERS.filter((receiver) => {
    const infoFile = `${receiver.info.replace('@xml/', '')}.xml`;
    const className = receiver.name.slice(receiver.name.lastIndexOf('.') + 1);

    const infoPath = path.join(source, 'res', 'xml', infoFile);
    const classRel = ['java', ...WIDGET_PACKAGE_SEGMENTS, `${className}.kt`];
    const classPath = path.join(source, ...classRel);

    const missing = [];
    if (!fs.existsSync(infoPath)) missing.push(`res/xml/${infoFile}`);
    if (!fs.existsSync(classPath)) missing.push(classRel.join('/'));

    if (missing.length > 0) {
      console.warn(
        `${TAG} ${className} receiver 를 건너뜁니다 — ${SOURCE_REL} 에 ${missing.join(', ')} 이 없습니다.`,
      );
      return false;
    }
    return true;
  });
}

function toManifestReceiver(receiver) {
  return {
    $: {
      'android:name': receiver.name,
      'android:exported': 'false',
      'android:label': receiver.label,
    },
    'intent-filter': [
      { action: receiver.actions.map((action) => ({ $: { 'android:name': action } })) },
    ],
    'meta-data': [
      { $: { 'android:name': 'android.appwidget.provider', 'android:resource': receiver.info } },
    ],
  };
}

// ───────────────────────────────────────────────────────────── 조립

/**
 * 두 mod 의 **실행 순서에 의존하지 않는다.**
 *
 * 매니페스트 mod 는 존재 여부를 `android/`(복사 결과)가 아니라 `widgets/`(커밋된 정본)에서
 * 확인한다. 정본은 mod 가 돌기 전부터 디스크에 있으므로, Expo 가 dangerous mod 를 먼저
 * 돌리든 나중에 돌리든 판정 결과가 같다. 복사 결과를 봤다면 순서에 묶였을 것이다.
 */
function withMoraWidgets(config) {
  return withWidgetReceivers(withWidgetSources(config));
}

// prebuild 를 여러 번 돌리거나 플러그인이 두 번 등재돼도 1회만 적용된다.
module.exports = createRunOncePlugin(withMoraWidgets, 'mora-android-widgets', '1.0.0');
