/**
 * Expo 동적 설정.
 *
 * ⚠️ 왜 .ts 가 아니라 .js 인가
 *   eas-cli 가 app config 를 다시 읽어 수정하려 할 때 프로젝트의 typescript 6.0 을 써서
 *   트랜스파일하는데, 여기서 `Cannot read properties of undefined (reading 'CommonJS')` 로
 *   깨진다(TS 6 에서 ModuleKind API 변경). .js 로 두면 트랜스파일 경로 자체가 사라진다.
 *   타입 보조는 JSDoc 으로 유지한다.
 *
 * APP_VARIANT 으로 빌드 프로파일별 설정을 분기한다. (eas.json 의 각 profile.env 에서 주입)
 *   - development : 개발 클라이언트. 패키지명에 .dev 를 붙여 preview 빌드와 한 기기에 공존 가능
 *   - preview     : 내부 배포용 release APK. **LAN IP 평문 HTTP 로 백엔드에 붙으므로 cleartext 필수**
 *   - production  : 클라우드 HTTPS 전제. cleartext 차단
 */

/** @type {'development' | 'preview' | 'production'} */
const VARIANT = process.env.APP_VARIANT ?? 'development';

const IS_DEV = VARIANT === 'development';
const ALLOW_CLEARTEXT = VARIANT !== 'production';

/**
 * EAS 프로젝트 ID (@mimimiminus-team/mora-mobile).
 * 동적 config 는 eas-cli 가 자동 기입할 수 없어 직접 적는다.
 * https://expo.dev/accounts/mimimiminus-team/projects/mora-mobile
 */
const EAS_PROJECT_ID = '27aa700a-3cf0-4ed4-98ab-b4fd2154436a';

/**
 * @param {{ config: import('expo/config').ExpoConfig }} ctx
 * @returns {import('expo/config').ExpoConfig}
 */
module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? 'MORA (dev)' : 'MORA',
  slug: 'mora-mobile',
  // EAS 계정이 여러 개라 소유 계정을 명시한다. 팀원이 빌드 링크를 공유받으려면 팀 계정이어야 한다.
  owner: 'mimimiminus-team',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'mora',
  // 다크모드 동결 중 — 라이트 고정. 팔레트·전환 배선은 코드에 남아 있고
  // src/store/themeStore.ts 의 THEME_DARK_ENABLED 를 true 로 되돌리면 'automatic' 으로 함께 복구한다.
  userInterfaceStyle: 'light',
  // 아래 아이콘·스플래시 PNG 7장은 전부 `npm run gen:icons`(scripts/gen-icons.mjs)가
  // `assets/brand/mora-logo-lg.svg` 한 장에서 생성한다. **손으로 교체하지 않는다** —
  // 로고가 바뀌면 스크립트를 다시 돌린다 (FR-110).
  icon: './assets/images/icon.png',
  // New Architecture 는 SDK 57 에서 기본이자 필수라 플래그가 제거되었다.

  // 웹은 v1 배포 대상이 아니지만(안드로이드 전용) `expo export --platform web` 이
  // 파비콘을 찾지 못해 Expo 기본 이미지로 떨어지는 것을 막는다.
  web: {
    favicon: './assets/images/favicon.png',
  },

  android: {
    package: IS_DEV ? 'com.mora.app.dev' : 'com.mora.app',
    // 전경·모노크롬은 108dp 캔버스의 **중앙 66dp 원**(원형/스퀘어클/사각 마스크 3종의 교집합)
    // 안에 로고를 넣어 생성돼 있다. 마스크 종류와 무관하게 잘리지 않는다 — FR-110 완료 조건.
    adaptiveIcon: {
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      // Android 13+ 테마 아이콘. 흰 실루엣이며 색은 런처가 tint 한다(에셋 색은 무의미).
      monochromeImage: './assets/images/android-icon-monochrome.png',
      // backgroundImage 가 있으면 이 값은 쓰이지 않지만, 이미지 로드 실패 시 폴백이라 같은 값을 유지한다.
      // 테마 무관 고정 — Design Tokens §10-5 (tokens.ts light.brand.base).
      backgroundColor: '#15293D',
    },
    // SDK 57 / RN 0.86 은 edge-to-edge 가 항상 켜져 있어 별도 플래그가 없다.
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.CAMERA',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.VIBRATE',
    ],
    // 요청하지 않은 권한이 매니페스트 병합으로 끼어드는 것을 막는다.
    //  - RECORD_AUDIO: expo-camera 가 recordAudioAndroid:false 여도 추가한다. 영상 녹화를 쓰지 않으므로 제거.
    //  - SYSTEM_ALERT_WINDOW: expo-dev-client 의 개발 메뉴용. 개발 빌드에서만 남긴다.
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      ...(IS_DEV ? [] : ['android.permission.SYSTEM_ALERT_WINDOW']),
    ],
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    // 안드로이드 홈 위젯(RemoteViews) 네이티브 소스 주입. `widgets/android/src/main/` → `android/app/src/main/`
    // + AndroidManifest 에 receiver 2개. 새 gradle 플러그인은 추가하지 않는다.
    './plugins/withMoraWidgets',
    [
      'expo-splash-screen',
      {
        // 투명 배경 + 네이비 마크. 파일이 마크에 딱 맞게 잘려 있어 imageWidth 가 곧 로고 크기다
        // (여백이 남아 있으면 그만큼 로고가 작아진다).
        image: './assets/images/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        // bg.base 와 같은 값 — 스플래시→첫 화면 배경색 점프를 없앤다 (Design Tokens §13-6).
        backgroundColor: '#FFFFFF',
        // dark 변형은 다크모드 동결로 제거. 복구 시 { backgroundColor: '#0F1621' } 를 되돌린다.
        // 그때 필요한 다크 로고는 gen-icons.mjs 에 대상 1줄(색만 다크 brand)을 추가하면 나온다.
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'MORA가 명함·영수증·포스터·티켓을 촬영하려면 카메라 접근이 필요합니다.',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: '갤러리에 있는 문서 사진을 불러오려면 사진 접근 권한이 필요합니다.',
      },
    ],
    [
      'expo-notifications',
      {
        // 상태바 아이콘. Android 는 이 PNG 의 **알파만** 읽고 색은 통째로 무시하므로
        // 반드시 흰 실루엣 + 투명 배경이어야 한다. 컬러 아이콘을 넣으면 흰 사각형이 뜬다.
        icon: './assets/images/notification-icon.png',
        // 위 실루엣에 입혀지는 강조색 (tokens.ts light.action.base).
        color: '#0077B6',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 26,
          // LAN IP 평문 HTTP 백엔드(:8080 Spring, :8000 OCR)에 붙기 위한 예외.
          // production 프로파일에서는 반드시 false 로 떨어진다.
          usesCleartextTraffic: ALLOW_CLEARTEXT,
        },
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
  },

  extra: {
    ...config.extra,
    variant: VARIANT,
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
});
