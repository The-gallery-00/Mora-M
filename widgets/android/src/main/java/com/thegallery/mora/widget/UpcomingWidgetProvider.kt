package com.thegallery.mora.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate

/**
 * 다가오는 일정 위젯 (`res/layout/widget_upcoming.xml`).
 *
 * 표시 개수는 위젯 높이로 정한다 — RemoteViews 로는 행을 만들 수 없어 레이아웃에 5행을 미리
 * 정의해 두고 남는 행을 GONE 으로 접는다.
 *   4x2(110dp) → 3개 / 4x3(180dp) → 4개 / 4x4(250dp 이상) → 5개
 *
 * 탭 동작
 *   - 항목 → `mora://doc/<card|ticket|poster|receipt>/<id>` (Navigation Map DL-03~05)
 *   - 헤더 → `mora://` (앱 홈)
 *   - ↻    → [ACTION_REFRESH] 자체 브로드캐스트(파일 다시 읽기). 30분 주기 갱신을 기다리지 않는 유일한 수단.
 *   - 빈 상태 → `mora://scan` (DL-06)
 *
 * **reapply 주의**: 런처는 같은 layout id 로 갱신이 오면 기존 뷰에 액션만 덧입힌다.
 * 그래서 텍스트·색·배경·가시성을 매 갱신마다 **모든 행에 대해 다시 지정**한다.
 * 하나라도 조건부로 빠뜨리면 이전 갱신의 값이 남는다.
 */
class UpcomingWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    for (appWidgetId in appWidgetIds) {
      render(context, appWidgetManager, appWidgetId)
    }
  }

  /** 사용자가 위젯 크기를 바꾼 순간. 표시 개수를 다시 계산해 그린다. */
  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle,
  ) {
    render(context, appWidgetManager, appWidgetId, newOptions)
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == ACTION_REFRESH) {
      renderAll(context)
      return
    }
    super.onReceive(context, intent)
  }

  private fun renderAll(context: Context) {
    try {
      val manager: AppWidgetManager = AppWidgetManager.getInstance(context) ?: return
      val ids: IntArray = manager.getAppWidgetIds(
        ComponentName(context, UpcomingWidgetProvider::class.java),
      )
      for (id in ids) render(context, manager, id)
    } catch (t: Throwable) {
      Log.w(TAG, "전체 갱신 실패", t)
    }
  }

  /**
   * 한 인스턴스를 그린다. 어떤 예외도 밖으로 내보내지 않는다 —
   * provider 에서 예외가 나가면 런처에 "위젯을 로드할 수 없음" 이 남는다.
   */
  private fun render(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    options: Bundle? = null,
  ) {
    try {
      val layoutId: Int = WidgetRes.layout(context, LAYOUT)
      if (layoutId == 0) {
        Log.w(TAG, "레이아웃 $LAYOUT 을 찾지 못했다 — 갱신 생략")
        return
      }

      val views = RemoteViews(context.packageName, layoutId)
      val today: LocalDate = LocalDate.now()
      val data: WidgetData = WidgetData.load(context)
      val resolvedOptions: Bundle? = options ?: readOptions(appWidgetManager, appWidgetId)

      renderHeader(context, views, appWidgetId, today)
      renderRows(context, views, appWidgetId, data, today, rowCapacity(resolvedOptions))
      renderEmptyState(context, views, appWidgetId, data)

      appWidgetManager.updateAppWidget(appWidgetId, views)
    } catch (t: Throwable) {
      Log.w(TAG, "위젯 #$appWidgetId 갱신 실패", t)
    }
  }

  /* ── 헤더 ─────────────────────────────────────────────────────────── */

  private fun renderHeader(
    context: Context,
    views: RemoteViews,
    appWidgetId: Int,
    today: LocalDate,
  ) {
    views.textSafe(WidgetRes.id(context, "upcoming_date"), WidgetTheme.headerDate(today))

    val home: PendingIntent? =
      deepLinkPendingIntent(context, WidgetData.LINK_HOME, requestCode(appWidgetId, SLOT_HEADER))
    if (home != null) {
      val headerId: Int = WidgetRes.id(context, "upcoming_header")
      if (headerId != 0) views.setOnClickPendingIntent(headerId, home)
    }

    val refresh: PendingIntent? = selfBroadcastPendingIntent(
      context = context,
      target = UpcomingWidgetProvider::class.java,
      action = ACTION_REFRESH,
      requestCode = requestCode(appWidgetId, SLOT_REFRESH),
      discriminator = "upcoming/$appWidgetId/refresh",
      extras = mapOf(AppWidgetManager.EXTRA_APPWIDGET_ID to appWidgetId),
    )
    if (refresh != null) {
      val refreshId: Int = WidgetRes.id(context, "upcoming_refresh")
      if (refreshId != 0) views.setOnClickPendingIntent(refreshId, refresh)
    }
  }

  /* ── 항목 행 ──────────────────────────────────────────────────────── */

  private fun renderRows(
    context: Context,
    views: RemoteViews,
    appWidgetId: Int,
    data: WidgetData,
    today: LocalDate,
    capacity: Int,
  ) {
    val shown: Int = minOf(capacity, data.items.size, WidgetData.MAX_ITEMS)

    for (slot in 0 until WidgetData.MAX_ITEMS) {
      val rowId: Int = WidgetRes.id(context, "row$slot")
      if (slot >= shown) {
        views.visibilitySafe(rowId, View.GONE)
        continue
      }
      views.visibilitySafe(rowId, View.VISIBLE)

      val item: WidgetItem = data.items[slot]
      val days: Long? = item.daysUntil(today)

      // D-day 배지 — 값이 없으면(과거 일정·날짜 불명) INVISIBLE 로 자리만 남긴다.
      // 텍스트/색/배경은 가시성과 무관하게 매번 갱신한다(reapply 잔상 방지).
      val badgeId: Int = WidgetRes.id(context, "row${slot}_dday")
      val label: String = WidgetTheme.dDayLabel(days)
      views.textSafe(badgeId, label)
      views.textColorSafe(badgeId, WidgetTheme.dDayColor(days))
      views.backgroundSafe(
        badgeId,
        WidgetRes.drawable(context, WidgetTheme.dDayBadgeDrawableName(days)),
      )
      views.visibilitySafe(badgeId, if (label.isEmpty()) View.INVISIBLE else View.VISIBLE)

      views.textSafe(WidgetRes.id(context, "row${slot}_title"), item.title)

      val subId: Int = WidgetRes.id(context, "row${slot}_sub")
      views.textSafe(subId, item.subtitle)
      views.visibilitySafe(subId, if (item.subtitle.isEmpty()) View.GONE else View.VISIBLE)

      val dotKey: String = if (item.docType.isNotEmpty()) item.docType else item.routeSegment
      views.imageSafe(
        WidgetRes.id(context, "row${slot}_dot"),
        WidgetRes.drawable(context, WidgetTheme.dotDrawableName(dotKey)),
      )

      val open: PendingIntent? =
        deepLinkPendingIntent(context, item.deepLink, requestCode(appWidgetId, slot))
      if (open != null && rowId != 0) views.setOnClickPendingIntent(rowId, open)
    }
  }

  /* ── 빈 상태 ──────────────────────────────────────────────────────── */

  private fun renderEmptyState(
    context: Context,
    views: RemoteViews,
    appWidgetId: Int,
    data: WidgetData,
  ) {
    val isEmpty: Boolean = data.items.isEmpty()
    views.visibilitySafe(WidgetRes.id(context, "upcoming_list"), if (isEmpty) View.GONE else View.VISIBLE)

    val emptyId: Int = WidgetRes.id(context, "upcoming_empty")
    views.visibilitySafe(emptyId, if (isEmpty) View.VISIBLE else View.GONE)

    val scan: PendingIntent? =
      deepLinkPendingIntent(context, WidgetData.LINK_SCAN, requestCode(appWidgetId, SLOT_EMPTY))
    if (scan != null && emptyId != 0) views.setOnClickPendingIntent(emptyId, scan)
  }

  /* ── 크기 → 표시 개수 ─────────────────────────────────────────────── */

  private fun readOptions(appWidgetManager: AppWidgetManager, appWidgetId: Int): Bundle? = try {
    appWidgetManager.getAppWidgetOptions(appWidgetId)
  } catch (t: Throwable) {
    null
  }

  /**
   * `OPTION_APPWIDGET_MIN_HEIGHT` 는 **dp** 단위의 세로 최소 높이다(런처 셀 n개 = 70n - 30).
   * 값을 못 읽으면 가장 작은 크기(3개)로 가정한다 — 넘치는 것보다 덜 보이는 쪽이 안전하다.
   */
  private fun rowCapacity(options: Bundle?): Int {
    val minHeight: Int = try {
      options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
    } catch (t: Throwable) {
      0
    }
    return when {
      minHeight >= 250 -> 5
      minHeight >= 180 -> 4
      else -> 3
    }
  }

  private fun requestCode(appWidgetId: Int, slot: Int): Int = appWidgetId * 100 + slot

  companion object {
    private const val TAG = "MoraWidget"
    private const val LAYOUT = "widget_upcoming"

    /**
     * 파일을 다시 읽어 즉시 그린다. 위젯 헤더의 ↻ 가 자기 자신에게 보내는 **명시적** 브로드캐스트다.
     *
     * plugins/withMoraWidgets.js 가 receiver 를 `exported="false"` 로 넣으므로
     * `adb shell am broadcast` (shell uid) 로는 전달되지 않는다 — 손으로 시험할 때는
     * ↻ 를 누르거나, 위젯을 지우고 다시 놓아 APPWIDGET_UPDATE 를 유발한다.
     */
    const val ACTION_REFRESH: String = "com.thegallery.mora.widget.ACTION_REFRESH_UPCOMING"

    private const val SLOT_HEADER: Int = 90
    private const val SLOT_REFRESH: Int = 91
    private const val SLOT_EMPTY: Int = 92
  }
}
