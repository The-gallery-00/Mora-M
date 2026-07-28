package com.mora.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate
import java.time.YearMonth

/**
 * 월간 달력 위젯 (`res/layout/widget_calendar.xml`, 4x4).
 *
 * RemoteViews 는 뷰를 런타임에 만들 수 없어 레이아웃에 **42칸(6주 x 7일)** 을 미리 정의하고
 * `setTextViewText` / `setTextColor` / `setViewVisibility` / `setInt(setBackgroundResource)` 로만 채운다.
 * 날짜 계산은 `Calendar` 대신 `java.time`(minSdk 26 에서 가용)의 `LocalDate` / `YearMonth` 를 쓴다.
 *
 * 탭 동작
 *   - 날짜 → `mora://calendar?date=YYYY-MM-DD` (SCR-07)
 *   - ◀ ▶ → [ACTION_MONTH_SHIFT] (`delta` = -1 / +1). 표시 중인 월은 위젯 id 별로
 *            SharedPreferences 에 **이번 달로부터의 offset** 으로 저장한다.
 *            절대 월("2026-07")이 아니라 offset 을 저장하는 이유: 달이 바뀌어도 offset 0 이
 *            자동으로 '이번 달'을 가리켜 위젯이 과거에 멈추지 않는다.
 *   - 월 라벨 → [ACTION_REFRESH] (offset 을 0 으로 되돌리고 파일을 다시 읽는다)
 *
 * **reapply 주의**: 런처는 같은 layout id 로 갱신이 오면 기존 뷰에 액션만 덧입힌다.
 * 그래서 42칸 **전부**의 숫자·색·배경·점을 매 갱신마다 다시 지정한다(조건부로 빠뜨리면 잔상이 남는다).
 */
class CalendarWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    for (appWidgetId in appWidgetIds) {
      render(context, appWidgetManager, appWidgetId)
    }
  }

  override fun onReceive(context: Context, intent: Intent) {
    try {
      when (intent.action) {
        ACTION_MONTH_SHIFT -> {
          val delta: Int = intent.getIntExtra(EXTRA_DELTA, 0)
          for (id in targetIds(context, intent)) {
            shiftMonth(context, id, delta)
            render(context, AppWidgetManager.getInstance(context), id)
          }
          return
        }

        ACTION_REFRESH -> {
          val reset: Boolean = intent.getBooleanExtra(EXTRA_RESET_MONTH, false)
          for (id in targetIds(context, intent)) {
            if (reset) storeOffset(context, id, 0)
            render(context, AppWidgetManager.getInstance(context), id)
          }
          return
        }
      }
    } catch (t: Throwable) {
      Log.w(TAG, "브로드캐스트 처리 실패: ${intent.action}", t)
      return
    }
    super.onReceive(context, intent)
  }

  /** 위젯이 지워지면 저장한 월 offset 도 지운다. */
  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    try {
      val editor: SharedPreferences.Editor = prefs(context).edit()
      for (id in appWidgetIds) editor.remove(offsetKey(id))
      editor.apply()
    } catch (t: Throwable) {
      Log.w(TAG, "월 offset 정리 실패", t)
    }
    super.onDeleted(context, appWidgetIds)
  }

  /* ── 그리기 ───────────────────────────────────────────────────────── */

  private fun render(context: Context, appWidgetManager: AppWidgetManager?, appWidgetId: Int) {
    if (appWidgetManager == null) return
    try {
      val layoutId: Int = WidgetRes.layout(context, LAYOUT)
      if (layoutId == 0) {
        Log.w(TAG, "레이아웃 $LAYOUT 을 찾지 못했다 — 갱신 생략")
        return
      }

      val views = RemoteViews(context.packageName, layoutId)
      val today: LocalDate = LocalDate.now()
      val month: YearMonth = YearMonth.from(today).plusMonths(loadOffset(context, appWidgetId).toLong())
      val data: WidgetData = WidgetData.load(context)

      renderHeader(context, views, appWidgetId, month)
      renderGrid(context, views, appWidgetId, month, today, data)

      appWidgetManager.updateAppWidget(appWidgetId, views)
    } catch (t: Throwable) {
      Log.w(TAG, "달력 위젯 #$appWidgetId 갱신 실패", t)
    }
  }

  private fun renderHeader(
    context: Context,
    views: RemoteViews,
    appWidgetId: Int,
    month: YearMonth,
  ) {
    val monthId: Int = WidgetRes.id(context, "calendar_month")
    views.textSafe(monthId, WidgetTheme.monthTitle(month))

    bindBroadcast(
      context, views, WidgetRes.id(context, "calendar_prev"),
      ACTION_MONTH_SHIFT, requestCode(appWidgetId, SLOT_PREV),
      "calendar/$appWidgetId/prev",
      mapOf(EXTRA_DELTA to -1, AppWidgetManager.EXTRA_APPWIDGET_ID to appWidgetId),
    )
    bindBroadcast(
      context, views, WidgetRes.id(context, "calendar_next"),
      ACTION_MONTH_SHIFT, requestCode(appWidgetId, SLOT_NEXT),
      "calendar/$appWidgetId/next",
      mapOf(EXTRA_DELTA to 1, AppWidgetManager.EXTRA_APPWIDGET_ID to appWidgetId),
    )

    // 월 라벨 탭 = 이번 달로 복귀 + 파일 다시 읽기.
    val reset: PendingIntent? = selfBroadcastPendingIntent(
      context = context,
      target = CalendarWidgetProvider::class.java,
      action = ACTION_REFRESH,
      requestCode = requestCode(appWidgetId, SLOT_RESET),
      discriminator = "calendar/$appWidgetId/reset",
      extras = mapOf(AppWidgetManager.EXTRA_APPWIDGET_ID to appWidgetId),
      flags = mapOf(EXTRA_RESET_MONTH to true),
    )
    if (reset != null && monthId != 0) views.setOnClickPendingIntent(monthId, reset)
  }

  private fun bindBroadcast(
    context: Context,
    views: RemoteViews,
    viewId: Int,
    action: String,
    requestCode: Int,
    discriminator: String,
    extras: Map<String, Int>,
  ) {
    if (viewId == 0) return
    val pending: PendingIntent? = selfBroadcastPendingIntent(
      context = context,
      target = CalendarWidgetProvider::class.java,
      action = action,
      requestCode = requestCode,
      discriminator = discriminator,
      extras = extras,
    )
    if (pending != null) views.setOnClickPendingIntent(viewId, pending)
  }

  /**
   * 42칸을 채운다. 그리드는 **일요일 시작**이다(요일 행 `일 월 화 수 목 금 토` 와 맞춘다).
   * `java.time` 의 요일 값은 월=1 … 일=7 이라 `% 7` 로 일요일을 0 으로 접는다.
   */
  private fun renderGrid(
    context: Context,
    views: RemoteViews,
    appWidgetId: Int,
    month: YearMonth,
    today: LocalDate,
    data: WidgetData,
  ) {
    val firstOfMonth: LocalDate = month.atDay(1)
    val leading: Int = WidgetTheme.weekdayIndex(firstOfMonth)
    val gridStart: LocalDate = firstOfMonth.minusDays(leading.toLong())
    val todayCircle: Int = WidgetRes.drawable(context, "widget_today_circle")

    for (index in 0 until GRID_CELLS) {
      val date: LocalDate = gridStart.plusDays(index.toLong())
      val inMonth: Boolean = YearMonth.from(date) == month
      val isToday: Boolean = date == today

      val dayId: Int = WidgetRes.id(context, "d$index")
      views.textSafe(dayId, date.dayOfMonth.toString())
      views.textColorSafe(
        dayId,
        if (isToday) WidgetTheme.TEXT_INVERSE else WidgetTheme.dayColor(date, inMonth),
      )
      // 오늘이 아닌 칸은 배경을 0(없음)으로 되돌린다 — 지정하지 않으면 이전 갱신의 원이 남는다.
      views.backgroundSafe(dayId, if (isToday) todayCircle else 0)

      // 점은 GONE 이 아니라 INVISIBLE 이다. GONE 이면 칸 높이가 달라져 그리드가 흔들린다.
      val marked: Boolean = data.marksOf(YearMonth.from(date)).contains(date.dayOfMonth)
      views.visibilitySafe(
        WidgetRes.id(context, "d${index}_dot"),
        if (marked) View.VISIBLE else View.INVISIBLE,
      )

      val open: PendingIntent? = deepLinkPendingIntent(
        context,
        WidgetData.linkCalendar(date),
        requestCode(appWidgetId, index),
      )
      if (open != null && dayId != 0) views.setOnClickPendingIntent(dayId, open)
    }
  }

  /* ── 표시 중인 월 (위젯 id 별 offset) ─────────────────────────────── */

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun offsetKey(appWidgetId: Int): String = "calendar_month_offset_$appWidgetId"

  private fun loadOffset(context: Context, appWidgetId: Int): Int = try {
    clampOffset(prefs(context).getInt(offsetKey(appWidgetId), 0))
  } catch (t: Throwable) {
    0
  }

  private fun storeOffset(context: Context, appWidgetId: Int, offset: Int) {
    try {
      prefs(context).edit().putInt(offsetKey(appWidgetId), clampOffset(offset)).apply()
    } catch (t: Throwable) {
      Log.w(TAG, "월 offset 저장 실패", t)
    }
  }

  private fun shiftMonth(context: Context, appWidgetId: Int, delta: Int) {
    if (delta == 0) return
    storeOffset(context, appWidgetId, loadOffset(context, appWidgetId) + delta)
  }

  /** ±10년. 무한 스크롤을 막고 `plusMonths` 오버플로 여지도 없앤다. */
  private fun clampOffset(offset: Int): Int = offset.coerceIn(-MAX_OFFSET, MAX_OFFSET)

  /** 브로드캐스트가 특정 위젯을 지목하지 않으면(런처 재시작 등) 전체 인스턴스를 대상으로 한다. */
  private fun targetIds(context: Context, intent: Intent): IntArray {
    val single: Int = intent.getIntExtra(
      AppWidgetManager.EXTRA_APPWIDGET_ID,
      AppWidgetManager.INVALID_APPWIDGET_ID,
    )
    if (single != AppWidgetManager.INVALID_APPWIDGET_ID) return intArrayOf(single)
    return try {
      AppWidgetManager.getInstance(context)
        .getAppWidgetIds(ComponentName(context, CalendarWidgetProvider::class.java))
    } catch (t: Throwable) {
      IntArray(0)
    }
  }

  private fun requestCode(appWidgetId: Int, slot: Int): Int = appWidgetId * 100 + slot

  companion object {
    private const val TAG = "MoraWidget"
    private const val LAYOUT = "widget_calendar"
    private const val PREFS_NAME = "mora_widget"
    private const val GRID_CELLS = 42
    private const val MAX_OFFSET = 120

    /**
     * 월 이동. **명시적 브로드캐스트 전용**(매니페스트 intent-filter 에 넣지 않는다).
     * extras: [EXTRA_DELTA] = -1 / +1, `AppWidgetManager.EXTRA_APPWIDGET_ID`(= "appWidgetId").
     */
    const val ACTION_MONTH_SHIFT: String = "com.mora.app.widget.ACTION_MONTH_SHIFT"

    /** 파일 다시 읽기. [EXTRA_RESET_MONTH] 가 true 면 표시 월을 이번 달로 되돌린다. */
    const val ACTION_REFRESH: String = "com.mora.app.widget.ACTION_REFRESH_CALENDAR"

    const val EXTRA_DELTA: String = "delta"
    const val EXTRA_RESET_MONTH: String = "resetMonth"

    private const val SLOT_PREV: Int = 90
    private const val SLOT_NEXT: Int = 91
    private const val SLOT_RESET: Int = 92
  }
}
