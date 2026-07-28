package com.mora.app.widget

import android.content.Context
import android.widget.RemoteViews

/**
 * 위젯 리소스 id 를 **런타임에 이름으로** 찾는다.
 *
 * ── 왜 `import com.mora.app.R` 을 하지 않는가 ─────────────────────────────
 * `expo prebuild` 가 `android/app/build.gradle` 의 `namespace` 를 app.config.js 의
 * `android.package` 값으로 덮어쓴다(@expo/config-plugins 57.0.6 —
 * `build/android/Package.js` 의 `setPackageInBuildGradle`: `(applicationId|namespace) '...'` 를
 * 한 정규식으로 같이 치환한다). 그래서 변형별 R 클래스 위치가 갈린다.
 *   - preview/production : namespace `com.mora.app`      → `com.mora.app.R`
 *   - development        : namespace `com.mora.app.dev`  → `com.mora.app.dev.R`
 * 소스에 어느 한쪽을 하드코딩하면 **다른 변형의 빌드가 컴파일 단계에서 깨진다**.
 * 이 파일의 클래스는 `com.mora.app.widget` 에 있고 Kotlin 은 부모 패키지를 암시적으로
 * 보지 않으므로 import 없이 `R` 을 쓸 수도 없다.
 * → `Resources.getIdentifier` 로 우회한다. 조회 결과는 캐시하므로 갱신 1회당 비용은 사실상 0 이다.
 *
 * ── 실패해도 죽지 않는다 ────────────────────────────────────────────────
 * 못 찾으면 0 을 돌려주고, 아래 확장 함수들이 id 0 을 **조용히 무시**한다.
 * 위젯 provider 에서 예외가 나가면 런처에 "위젯을 로드할 수 없음" 이 남으므로
 * 어떤 경우에도 예외를 던지지 않는다.
 *
 * 스레드: 위젯 갱신은 브로드캐스트 메인 스레드에서만 일어난다. 그래서 평범한 HashMap 으로 충분하다.
 */
internal object WidgetRes {
  private val cache: HashMap<String, Int> = HashMap()

  fun layout(context: Context, name: String): Int = find(context, "layout", name)

  fun id(context: Context, name: String): Int = find(context, "id", name)

  fun drawable(context: Context, name: String): Int = find(context, "drawable", name)

  private fun find(context: Context, type: String, name: String): Int {
    val key = "$type/$name"
    val cached: Int? = cache[key]
    if (cached != null) return cached

    var resolved = 0
    for (pkg in candidatePackages(context)) {
      resolved = try {
        context.resources.getIdentifier(name, type, pkg)
      } catch (t: Throwable) {
        0
      }
      if (resolved != 0) break
    }
    cache[key] = resolved
    return resolved
  }

  /**
   * 리소스 테이블 패키지 후보.
   *
   * expo 는 namespace 와 applicationId 를 **같은 값**으로 맞추므로(위 정규식이 둘을 함께 치환한다)
   * `context.packageName` 한 방에 끝난다. 나중에 누군가 `applicationIdSuffix` 로 변형을 만들어
   * 둘이 갈라지는 경우만 대비해 `.dev` 를 떼어낸 이름을 2순위로 둔다.
   */
  private fun candidatePackages(context: Context): List<String> {
    val appId: String = context.packageName
    return if (appId.endsWith(".dev")) listOf(appId, appId.removeSuffix(".dev")) else listOf(appId)
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   RemoteViews 안전 확장.
   id 가 0(=리소스 조회 실패)이면 아무 것도 하지 않는다. RemoteViews 는 존재하지 않는
   id 에 대해 apply 시점에 ActionException 을 던지므로 여기서 막는 것이 중요하다.
   허용 메서드만 쓴다: setTextViewText / setViewVisibility / setTextColor /
   setImageViewResource / setOnClickPendingIntent / setInt.
   ───────────────────────────────────────────────────────────────────────── */

internal fun RemoteViews.textSafe(viewId: Int, value: CharSequence) {
  if (viewId != 0) setTextViewText(viewId, value)
}

internal fun RemoteViews.visibilitySafe(viewId: Int, visibility: Int) {
  if (viewId != 0) setViewVisibility(viewId, visibility)
}

internal fun RemoteViews.textColorSafe(viewId: Int, color: Int) {
  if (viewId != 0) setTextColor(viewId, color)
}

internal fun RemoteViews.imageSafe(viewId: Int, drawableId: Int) {
  if (viewId != 0 && drawableId != 0) setImageViewResource(viewId, drawableId)
}

/**
 * 배경 drawable 교체. `View.setBackgroundResource` 는 `@RemotableViewMethod` 이므로
 * RemoteViews 의 리플렉션 setter(`setInt`)로 호출할 수 있다.
 * `drawableId = 0` 은 "배경 없음"이라는 정상 값이다(오늘 강조 원 해제).
 */
internal fun RemoteViews.backgroundSafe(viewId: Int, drawableId: Int) {
  if (viewId != 0) setInt(viewId, "setBackgroundResource", drawableId)
}
