package com.mora.app.widget

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth

/**
 * 위젯의 색·문구 포맷 헬퍼.
 *
 * 색은 `src/theme/tokens.ts` 의 **light 팔레트 복제**다(위젯은 RN 밖이라 NativeWind 가 닿지 않는다).
 * `res/values/widget_colors.xml` 에 같은 값이 한 벌 더 있다 — XML 레이아웃은 리소스를,
 * Kotlin 은 이 상수를 쓴다. `setTextColor` 가 int 를 요구하는데 리소스 조회가 실패하면
 * 검정으로 떨어져 읽을 수 없게 되므로 런타임 경로는 상수로 못박는다(의도된 중복).
 * **정본은 언제나 tokens.ts 다**(위키 Design Tokens §13-0). 바뀌면 두 곳을 함께 고친다.
 *
 * 다크 대응 없음: 앱이 다크모드 동결 중이고(app.config.js `userInterfaceStyle: 'light'`)
 * 위젯은 라이트 고정으로 둔다.
 */
internal object WidgetTheme {

  /* ── 색 (tokens.ts light) ─────────────────────────────────────────── */

  /** tokens.ts light.text.primary */
  val TEXT_PRIMARY: Int = 0xFF111111.toInt()

  /** tokens.ts light.text.secondary */
  val TEXT_SECONDARY: Int = 0xFF505050.toInt()

  /** tokens.ts light.text.muted */
  val TEXT_MUTED: Int = 0xFF64748B.toInt()

  /** tokens.ts light.text.disabled — 달력의 이번 달 아닌 날 */
  val TEXT_DISABLED: Int = 0xFF999999.toInt()

  /** tokens.ts light.text.inverse — 오늘 강조 원 위의 숫자 */
  val TEXT_INVERSE: Int = 0xFFFFFFFF.toInt()

  /** tokens.ts light.action.base — D-day 여유 */
  val ACTION: Int = 0xFF0077B6.toInt()

  /** tokens.ts light.doc.DEADLINE.fg — D-day 임박(<=3일) */
  val DEADLINE: Int = 0xFFB45309.toInt()

  /** tokens.ts light.calendar.sunday */
  val SUNDAY: Int = 0xFFDC2626.toInt()

  /** tokens.ts light.calendar.saturday */
  val SATURDAY: Int = 0xFF2563EB.toInt()

  /* ── D-day ────────────────────────────────────────────────────────── */

  /** SCR-06 색 규칙: 3일 이하면 마감색, 아니면 포인트색. */
  const val URGENT_DAYS: Long = 3L

  /**
   * `src/components/dashboard/DeadlineCard.tsx` 의 `dDayLabel` 과 같은 규칙.
   * 0 → `D-DAY`, 양수 → `D-n`, **음수·null → 빈 문자열**(호출부가 배지를 GONE 으로 접는다).
   */
  fun dDayLabel(days: Long?): String {
    val value: Long = days ?: return ""
    return when {
      value == 0L -> "D-DAY"
      value > 0L -> "D-$value"
      else -> ""
    }
  }

  fun dDayColor(days: Long?): Int =
    if (days != null && days <= URGENT_DAYS) DEADLINE else ACTION

  fun dDayBadgeDrawableName(days: Long?): String =
    if (days != null && days <= URGENT_DAYS) "widget_badge_urgent" else "widget_badge_normal"

  /* ── 날짜 문구 (한국어) ───────────────────────────────────────────── */

  private val WEEKDAY_LABELS: Array<String> = arrayOf("일", "월", "화", "수", "목", "금", "토")

  /** 일요일=0 … 토요일=6. `java.time` 은 월요일=1 … 일요일=7 이라 7 로 나눈 나머지를 쓴다. */
  fun weekdayIndex(date: LocalDate): Int = date.dayOfWeek.value % 7

  fun weekdayLabel(date: LocalDate): String = WEEKDAY_LABELS[weekdayIndex(date)]

  /** `7월 28일 (월)` — 다가오는 일정 위젯 헤더. app/calendar.tsx 의 `formatDayHeading` 과 같은 형태. */
  fun headerDate(date: LocalDate): String =
    "${date.monthValue}월 ${date.dayOfMonth}일 (${weekdayLabel(date)})"

  /** `2026년 7월` — 달력 위젯 헤더. */
  fun monthTitle(month: YearMonth): String = "${month.year}년 ${month.monthValue}월"

  /** 달력 칸 숫자 색. 오늘은 호출부에서 별도로 반전색을 쓴다. */
  fun dayColor(date: LocalDate, inCurrentMonth: Boolean): Int = when {
    !inCurrentMonth -> TEXT_DISABLED
    date.dayOfWeek == DayOfWeek.SUNDAY -> SUNDAY
    date.dayOfWeek == DayOfWeek.SATURDAY -> SATURDAY
    else -> TEXT_PRIMARY
  }

  /* ── 문서유형 ─────────────────────────────────────────────────────── */

  /**
   * 문서유형 → 점 drawable 이름. 모르는 값은 중립 점으로 떨어진다.
   * 대문자 `DocumentType`(tokens.ts light.doc.*) 과 소문자 라우트 세그먼트를 모두 받는다.
   */
  fun dotDrawableName(docTypeOrSegment: String): String =
    when (docTypeOrSegment.uppercase()) {
      "BUSINESS_CARD", "CARD" -> "widget_dot_business_card"
      "TICKET" -> "widget_dot_ticket"
      "POSTER" -> "widget_dot_poster"
      "RECEIPT" -> "widget_dot_receipt"
      "DEADLINE" -> "widget_dot_deadline"
      else -> "widget_dot_default"
    }
}
