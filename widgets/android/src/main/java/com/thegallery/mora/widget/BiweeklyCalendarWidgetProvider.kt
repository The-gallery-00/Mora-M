package com.thegallery.mora.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate
import java.time.YearMonth

/**
 * 2주 달력 위젯 (`res/layout/widget_biweekly.xml`, 4x2).
 *
 * [CalendarWidgetProvider] (월간 4x4) 의 컴팩트 형제다. 헬퍼는 전부 공유한다 —
 * 날짜/색 계산은 [WidgetTheme], 일정 표시는 [WidgetData], 리소스 조회는 [WidgetRes],
 * PendingIntent 는 `WidgetLinks.kt`. **이 파일에는 중복 구현이 없다.**
 *
 * 월간판과 다른 점
 *   1. 보여주는 범위가 **오늘이 포함된 주 + 다음 주** 14일 고정이다(항상 오늘이 첫 주에 있다).
 *   2. **월 이동이 없다.** 4x2 에 화살표를 넣을 세로 여유가 없고, 표시 범위가 오늘에
 *      묶여 있어 저장할 상태도 없다 → SharedPreferences 도 `onDeleted` 정리도 필요 없다.
 *   3. "이번 달"의 기준은 **오늘의 달**이다. 2주가 달을 걸치면 다른 달 쪽이 흐리게(TEXT_DISABLED) 나온다.
 *
 * 탭 동작
 *   - 날짜 → `mora://calendar?date=YYYY-MM-DD` (SCR-07, [WidgetData.linkCalendar])
 *   - 헤더 → `mora://calendar` (날짜 없이 캘린더 화면)
 *   - ↻    → [CalendarWidgetProvider.ACTION_REFRESH] **재사용**. 명시적 브로드캐스트라
 *            `component` 로 목적지가 정해지고 action 문자열은 라우팅에 쓰이지 않는다.
 *            그래서 달력 위젯과 같은 액션을 써도 서로의 갱신을 건드리지 않는다.
 *            (월 이동이 없으므로 `EXTRA_RESET_MONTH` 는 무시한다.)
 *
 * 주 시작은 **일요일**이다(한국 관례). `java.time` 은 월=1 … 일=7 이므로 접는 계산은
 * [WidgetTheme.weekdayIndex] 하나로 통일한다 — 월간판과 같은 함수다.
 *
 * **reapply 주의**: 런처는 같은 layout id 로 갱신이 오면 기존 뷰에 액션만 덧입힌다.
 * 그래서 14칸 **전부**의 숫자·색·배경·점을 매 갱신마다 다시 지정한다(조건부로 빠뜨리면 잔상이 남는다).
 */
class BiweeklyCalendarWidgetProvider : AppWidgetProvider() {

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
    if (intent.action == CalendarWidgetProvider.ACTION_REFRESH) {
      try {
        for (id in targetIds(context, intent)) {
          render(context, AppWidgetManager.getInstance(context), id)
        }
      } catch (t: Throwable) {
        Log.w(TAG, "브로드캐스트 처리 실패: ${intent.action}", t)
      }
      return
    }
    super.onReceive(context, intent)
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
      val data: WidgetData = WidgetData.load(context)

      renderHeader(context, views, appWidgetId, today)
      renderGrid(context, views, appWidgetId, today, data)

      appWidgetManager.updateAppWidget(appWidgetId, views)
    } catch (t: Throwable) {
      Log.w(TAG, "2주 달력 위젯 #$appWidgetId 갱신 실패", t)
    }
  }

  private fun renderHeader(
    context: Context,
    views: RemoteViews,
    appWidgetId: Int,
    today: LocalDate,
  ) {
    // `7월 28일 (화)` — 다가오는 일정 위젯 헤더와 같은 포맷.
    views.textSafe(WidgetRes.id(context, "biweekly_date"), WidgetTheme.headerDate(today))

    val headerId: Int = WidgetRes.id(context, "biweekly_header")
    val open: PendingIntent? = deepLinkPendingIntent(
      context,
      LINK_CALENDAR,
      requestCode(appWidgetId, SLOT_HEADER),
    )
    if (open != null && headerId != 0) views.setOnClickPendingIntent(headerId, open)

    val refreshId: Int = WidgetRes.id(context, "biweekly_refresh")
    val refresh: PendingIntent? = selfBroadcastPendingIntent(
      context = context,
      target = BiweeklyCalendarWidgetProvider::class.java,
      action = CalendarWidgetProvider.ACTION_REFRESH,
      requestCode = requestCode(appWidgetId, SLOT_REFRESH),
      // discriminator 가 달력 위젯("calendar/…")과 달라 PendingIntent 가 접히지 않는다.
      discriminator = "biweekly/$appWidgetId/refresh",
      extras = mapOf(AppWidgetManager.EXTRA_APPWIDGET_ID to appWidgetId),
    )
    if (refresh != null && refreshId != 0) views.setOnClickPendingIntent(refreshId, refresh)
  }

  /**
   * 14칸을 채운다. 시작은 **오늘이 속한 주의 일요일**이라 오늘은 항상 첫 주 안에 있다.
   * 일정 점은 날짜별로 그 날짜의 달을 조회하므로 2주가 달을 걸쳐도 맞는다.
   */
  private fun renderGrid(
    context: Context,
    views: RemoteViews,
    appWidgetId: Int,
    today: LocalDate,
    data: WidgetData,
  ) {
    val weekStart: LocalDate = today.minusDays(WidgetTheme.weekdayIndex(today).toLong())
    val currentMonth: YearMonth = YearMonth.from(today)
    val todayCircle: Int = WidgetRes.drawable(context, "widget_today_circle")

    for (index in 0 until GRID_CELLS) {
      val date: LocalDate = weekStart.plusDays(index.toLong())
      val inMonth: Boolean = YearMonth.from(date) == currentMonth
      val isToday: Boolean = date == today

      val dayId: Int = WidgetRes.id(context, "bw$index")
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
        WidgetRes.id(context, "bw${index}_dot"),
        if (marked) View.VISIBLE else View.INVISIBLE,
      )

      val open: PendingIntent? = deepLinkPendingIntent(
        context,
        WidgetData.linkCalendar(date),
        requestCode(appWidgetId, SLOT_DAY_BASE + index),
      )
      if (open != null && dayId != 0) views.setOnClickPendingIntent(dayId, open)
    }
  }

  /** 브로드캐스트가 특정 위젯을 지목하지 않으면(런처 재시작 등) 전체 인스턴스를 대상으로 한다. */
  private fun targetIds(context: Context, intent: Intent): IntArray {
    val single: Int = intent.getIntExtra(
      AppWidgetManager.EXTRA_APPWIDGET_ID,
      AppWidgetManager.INVALID_APPWIDGET_ID,
    )
    if (single != AppWidgetManager.INVALID_APPWIDGET_ID) return intArrayOf(single)
    return try {
      AppWidgetManager.getInstance(context)
        .getAppWidgetIds(ComponentName(context, BiweeklyCalendarWidgetProvider::class.java))
    } catch (t: Throwable) {
      IntArray(0)
    }
  }

  /**
   * 다른 위젯들과 **같은 식**(`appWidgetId * 100 + slot`)이지만 slot 대역만 다르다.
   *
   * appWidgetId 는 시스템 전역에서 유일하므로 원칙적으로는 충돌이 없다. 그래도 대역을
   * 갈라 두는 이유: 위젯을 지웠다 다시 놓으면 id 가 **재사용**될 수 있고, 그때 아직 살아 있는
   * 옛 PendingIntent 와 (requestCode, action, data) 가 전부 겹치면 FLAG_UPDATE_CURRENT 로
   * 엉뚱한 딥링크가 덮어써진다. 대역이 다르면 그 경우에도 서로 닿지 않는다.
   *
   *   달력(월간)  0~41 (날짜), 90~92 (이전/다음/리셋)
   *   다가오는    0~4  (항목),  90~92 (헤더/새로고침/빈상태)
   *   2주 달력    50~63 (날짜), 96~97 (헤더/새로고침)   ← 이 파일
   */
  private fun requestCode(appWidgetId: Int, slot: Int): Int = appWidgetId * 100 + slot

  companion object {
    private const val TAG = "MoraWidget"
    private const val LAYOUT = "widget_biweekly"

    /** 오늘 주 + 다음 주 = 2주 x 7일. 레이아웃의 `bw0`~`bw13` 과 개수가 같아야 한다. */
    private const val GRID_CELLS = 14

    /** SCR-07 캘린더 화면(날짜 지정 없음). `WidgetData.SCHEME` 에서 유도해 스킴을 한 곳에만 둔다. */
    private val LINK_CALENDAR: String = "${WidgetData.SCHEME}://calendar"

    private const val SLOT_DAY_BASE: Int = 50
    private const val SLOT_HEADER: Int = 96
    private const val SLOT_REFRESH: Int = 97
  }
}
