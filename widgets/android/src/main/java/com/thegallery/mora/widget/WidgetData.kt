package com.thegallery.mora.widget

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDate
import java.time.YearMonth
import java.time.temporal.ChronoUnit

/**
 * RN ↔ 위젯 데이터 브리지의 **읽는 쪽**.
 *
 * ── 경로 (실측 확인) ────────────────────────────────────────────────────
 * RN 은 `expo-file-system` 의 `documentDirectory` 아래에 `widget-data.json` 을 쓴다.
 * expo-file-system 57.0.1 의 `documentDirectory` 는
 *   `Uri.fromFile(appContext.persistentFilesDirectory) + "/"`
 * (`android/src/main/java/expo/modules/filesystem/FileSystemModule.kt`)이고,
 * `persistentFilesDirectory` 는 expo-modules-core `AppDirectoriesService` 에서
 *   `context.filesDir`
 * 그대로다. 이 프로젝트 node_modules 에 `AppDirectoriesService` 를 재정의하는 패키지가 없다
 * (dev-client 포함해서 없음) → **`File(context.filesDir, "widget-data.json")` 이 맞다.**
 *
 * ── 스키마 (version 1) ──────────────────────────────────────────────────
 * ```json
 * {
 *   "version": 1,
 *   "updatedAt": "2026-07-28T09:12:00+09:00",
 *   "items": [
 *     {
 *       "id": "42",
 *       "type": "TICKET",              // BUSINESS_CARD | TICKET | POSTER | RECEIPT | DEADLINE
 *       "route": "ticket",             // 선택. 소문자 세그먼트(card|ticket|poster|receipt)
 *       "title": "서울 → 부산",
 *       "subtitle": "KTX · 14:20",     // 장소/시각
 *       "date": "2026-07-30",          // YYYY-MM-DD (ISO 8601 앞 10자만 봐도 된다)
 *       "dDay": 2,                     // 선택. date 가 없거나 깨졌을 때만 쓰는 폴백
 *       "deepLink": "mora://doc/ticket/42"   // 선택. 없으면 route/type + id 로 조립
 *     }
 *   ],
 *   "monthMarks": { "2026-07": [3, 12, 30] }   // 일정이 있는 날(일자 숫자)
 * }
 * ```
 * 파서는 **일부러 관대하다**(키 별칭 허용, 타입 혼용 허용). RN 쪽 필드명이 조금 달라도
 * 위젯이 빈 화면으로 떨어지지 않게 하려는 의도다. 별칭 목록은 각 파싱 지점 주석에 있다.
 *
 * ── 안전 규칙 ───────────────────────────────────────────────────────────
 * 1. 파일 없음 / JSON 깨짐 / 필드 타입 불일치 / 알 수 없는 version → **빈 데이터**를 돌려준다.
 * 2. 절대 예외를 던지지 않는다. provider 에서 예외가 나가면 런처에 "위젯을 로드할 수 없음" 이 뜬다.
 * 3. `dDay` 는 JSON 값을 그대로 믿지 않고 **`date` 로 매 갱신마다 다시 계산**한다.
 *    파일은 최대 30분(경우에 따라 며칠) 묵을 수 있어 저장된 D-day 가 틀리기 때문이다.
 */
internal data class WidgetItem(
  /** 서버 PK. 명함은 UUID(문자열), 티켓·포스터·영수증은 정수지만 위젯은 문자열로만 다룬다. */
  val id: String,
  /** `BUSINESS_CARD` 같은 대문자 유형. 색 점 결정용. 모르면 빈 문자열. */
  val docType: String,
  /** `card|ticket|poster|receipt` — 딥링크 세그먼트. 모르면 빈 문자열. */
  val routeSegment: String,
  val title: String,
  val subtitle: String,
  /** 파싱 실패 시 null. */
  val date: LocalDate?,
  /** JSON 에 들어 있던 dDay. `date` 가 없을 때만 쓰는 폴백. */
  val dDayFallback: Long?,
  /** 최종 딥링크. JSON 이 준 값 또는 `mora://doc/<segment>/<id>` 조립 결과. 없으면 빈 문자열. */
  val deepLink: String,
) {
  /** 오늘 기준 남은 일수. `date` 우선, 없으면 JSON 폴백. 둘 다 없으면 null → 배지를 접는다. */
  fun daysUntil(today: LocalDate): Long? =
    if (date != null) ChronoUnit.DAYS.between(today, date) else dDayFallback
}

internal data class WidgetData(
  val items: List<WidgetItem>,
  /** `"2026-07"` → 일정이 있는 날짜(일자) 집합. */
  val monthMarks: Map<String, Set<Int>>,
  /** 파일을 실제로 읽어 파싱까지 성공했는지. 실패 시 위젯은 빈 상태 문구를 보여준다. */
  val available: Boolean,
) {
  fun marksOf(month: YearMonth): Set<Int> = monthMarks[monthKey(month)] ?: emptySet()

  companion object {
    private const val TAG = "MoraWidget"

    /** RN 이 `documentDirectory` 에 쓰는 파일 이름. 양쪽이 이 상수를 지켜야 한다. */
    const val FILE_NAME: String = "widget-data.json"

    /** 이 파서가 아는 스키마 버전. 더 큰 값이 와도 아는 필드만 읽고 계속 간다. */
    const val SCHEMA_VERSION: Int = 1

    /** 위젯이 한 번에 보여줄 수 있는 최대 항목 수(레이아웃에 행 5개가 미리 정의돼 있다). */
    const val MAX_ITEMS: Int = 5

    /** 깨진/거대한 파일로 OOM 이 나는 것을 막는 상한. 정상 파일은 수 KB 다. */
    private const val MAX_FILE_BYTES: Long = 1L * 1024L * 1024L

    val EMPTY: WidgetData = WidgetData(emptyList(), emptyMap(), false)

    fun monthKey(month: YearMonth): String =
      "${month.year}-${month.monthValue.toString().padStart(2, '0')}"

    fun file(context: Context): File = File(context.filesDir, FILE_NAME)

    /** 절대 예외를 던지지 않는다. 어떤 실패도 [EMPTY] 로 수렴한다. */
    fun load(context: Context): WidgetData {
      return try {
        val source: File = file(context)
        if (!source.isFile) {
          Log.i(TAG, "widget-data.json 없음 — 빈 상태로 그린다")
          return EMPTY
        }
        if (source.length() <= 0L || source.length() > MAX_FILE_BYTES) {
          Log.w(TAG, "widget-data.json 크기 이상: ${source.length()}B")
          return EMPTY
        }
        parse(source.readText(Charsets.UTF_8))
      } catch (t: Throwable) {
        Log.w(TAG, "widget-data.json 읽기 실패", t)
        EMPTY
      }
    }

    /** 문자열 파싱. 테스트/디버깅에서 직접 부를 수 있게 열어 둔다. */
    fun parse(raw: String): WidgetData {
      return try {
        val root = JSONObject(raw)

        // version 은 검사만 하고 막지 않는다. 필드는 덧붙는 방향으로만 바뀔 것이고,
        // 모르는 키는 아래에서 전부 무시되므로 구버전·신버전 모두 최선 노력으로 읽는다.
        val version: Int = root.optInt("version", 0)
        if (version > SCHEMA_VERSION) {
          Log.i(TAG, "스키마 v$version (위젯은 v$SCHEMA_VERSION 까지 안다) — 아는 필드만 읽는다")
        }

        WidgetData(
          items = parseItems(firstArray(root, "items", "upcoming", "schedules", "events")),
          monthMarks = parseMonthMarks(root),
          available = true,
        )
      } catch (t: Throwable) {
        Log.w(TAG, "widget-data.json 파싱 실패", t)
        EMPTY
      }
    }

    /* ── items ──────────────────────────────────────────────────────── */

    private fun parseItems(array: JSONArray?): List<WidgetItem> {
      if (array == null) return emptyList()
      val out = ArrayList<WidgetItem>(MAX_ITEMS)
      var index = 0
      while (index < array.length() && out.size < MAX_ITEMS) {
        val raw: JSONObject? = array.optJSONObject(index)
        index += 1
        if (raw == null) continue
        val item: WidgetItem? = parseItem(raw)
        if (item != null) out.add(item)
      }
      return out
    }

    private fun parseItem(raw: JSONObject): WidgetItem? {
      // 제목이 없는 항목은 보여줄 게 없으므로 버린다.
      val title: String = str(raw, "title", "label", "name")
      if (title.isEmpty()) return null

      val id: String = str(raw, "id", "docId", "documentId", "sourceId")
      val docType: String = str(raw, "type", "docType", "documentType").uppercase()
      val segment: String = str(raw, "route", "routeSegment", "segment")
        .lowercase()
        .ifEmpty { routeSegmentOf(docType) }

      val explicitLink: String = str(raw, "deepLink", "link", "url")
      val deepLink: String = when {
        explicitLink.startsWith("$SCHEME://") -> explicitLink
        segment.isNotEmpty() && id.isNotEmpty() -> "$SCHEME://doc/$segment/$id"
        // 어디로 보낼지 모르면 앱 홈으로 보낸다(빈 문자열이면 호출부가 클릭을 걸지 않는다).
        else -> LINK_HOME
      }

      return WidgetItem(
        id = id,
        docType = docType,
        routeSegment = segment,
        title = title,
        subtitle = str(raw, "subtitle", "sub", "place", "location", "time"),
        date = parseDate(str(raw, "date", "startDate", "eventDate", "departureDate")),
        dDayFallback = optLong(raw, "dDay", "dday", "daysLeft"),
        deepLink = deepLink,
      )
    }

    /**
     * 대문자 `DocumentType` → 소문자 라우트 세그먼트.
     * `src/features/documents/types.ts` 의 `DOC_ROUTE_SEGMENT` 와 **같은 표**여야 한다
     * (Navigation Map §7 / 딥링크 DL-03~05: `mora://doc/{card|ticket|poster|receipt}/{id}`).
     */
    private fun routeSegmentOf(docType: String): String = when (docType) {
      "BUSINESS_CARD" -> "card"
      "TICKET" -> "ticket"
      "POSTER" -> "poster"
      "RECEIPT" -> "receipt"
      else -> ""
    }

    /** `2026-07-30`, `2026-07-30T14:20:00`, `2026-07-30 14:20` 모두 앞 10자만 본다. */
    private fun parseDate(value: String): LocalDate? {
      if (value.length < 10) return null
      return try {
        LocalDate.parse(value.substring(0, 10))
      } catch (t: Throwable) {
        null
      }
    }

    /* ── monthMarks ─────────────────────────────────────────────────── */

    /**
     * 허용 형태 3가지.
     *  1. `"monthMarks": { "2026-07": [3, 12, 30] }`  ← 정본
     *  2. `"monthMarks": { "2026-07": { "3": 2, "12": 1 } }`  (일자→건수)
     *  3. `"markedDates": ["2026-07-03", "2026-07-12"]`  (평평한 ISO 배열)
     * 배열 원소는 숫자(3)와 문자열("3", "2026-07-03") 모두 받는다.
     */
    private fun parseMonthMarks(root: JSONObject): Map<String, Set<Int>> {
      val out = HashMap<String, MutableSet<Int>>()

      val marks: JSONObject? = firstObject(root, "monthMarks", "marks")
      if (marks != null) {
        val keys = marks.keys()
        while (keys.hasNext()) {
          val key: String = keys.next()
          if (!isMonthKey(key)) continue
          val bucket: MutableSet<Int> = out.getOrPut(key) { HashSet() }
          when (val value: Any? = marks.opt(key)) {
            is JSONArray -> {
              for (i in 0 until value.length()) addDay(bucket, value.opt(i))
            }
            is JSONObject -> {
              val dayKeys = value.keys()
              while (dayKeys.hasNext()) addDay(bucket, dayKeys.next())
            }
            else -> addDay(bucket, value)
          }
        }
      }

      val flat: JSONArray? = firstArray(root, "markedDates", "markedDays", "dates")
      if (flat != null) {
        for (i in 0 until flat.length()) {
          val iso: String = flat.optString(i, "")
          val date: LocalDate = parseDate(iso) ?: continue
          val key: String = monthKey(YearMonth.from(date))
          out.getOrPut(key) { HashSet() }.add(date.dayOfMonth)
        }
      }

      return out
    }

    /** `"3"`, `3`, `"2026-07-03"` 을 모두 일자 숫자로 흡수한다. 1~31 밖은 버린다. */
    private fun addDay(bucket: MutableSet<Int>, value: Any?) {
      val day: Int = when (value) {
        is Number -> value.toInt()
        is String -> {
          val date: LocalDate? = parseDate(value)
          date?.dayOfMonth ?: value.trim().toIntOrNull() ?: 0
        }
        else -> 0
      }
      if (day in 1..31) bucket.add(day)
    }

    private fun isMonthKey(key: String): Boolean =
      key.length == 7 && key[4] == '-' &&
        key.substring(0, 4).toIntOrNull() != null &&
        (key.substring(5, 7).toIntOrNull() ?: 0) in 1..12

    /* ── JSON 유틸 (전부 예외를 삼킨다) ─────────────────────────────── */

    private fun str(source: JSONObject, vararg keys: String): String {
      for (key in keys) {
        if (!source.has(key) || source.isNull(key)) continue
        val value: String = source.optString(key, "").trim()
        if (value.isNotEmpty() && value != "null") return value
      }
      return ""
    }

    private fun optLong(source: JSONObject, vararg keys: String): Long? {
      for (key in keys) {
        if (!source.has(key) || source.isNull(key)) continue
        when (val value: Any? = source.opt(key)) {
          is Number -> return value.toLong()
          is String -> value.trim().toLongOrNull()?.let { return it }
        }
      }
      return null
    }

    private fun firstArray(source: JSONObject, vararg keys: String): JSONArray? {
      for (key in keys) source.optJSONArray(key)?.let { return it }
      return null
    }

    private fun firstObject(source: JSONObject, vararg keys: String): JSONObject? {
      for (key in keys) source.optJSONObject(key)?.let { return it }
      return null
    }

    /* ── 딥링크 (app.config.js `scheme: 'mora'`) ────────────────────── */

    const val SCHEME: String = "mora"

    /** 앱 홈. Navigation Map §5 의 공통 처리 규칙대로 인증 가드를 먼저 통과한다. */
    const val LINK_HOME: String = "mora://"

    /** DL-06 `mora://scan` — "홈 화면 롱프레스 퀵액션, 위젯" 용도로 이미 예약된 링크다. */
    const val LINK_SCAN: String = "mora://scan"

    /** SCR-07 캘린더. `date` 는 `YYYY-MM-DD`. */
    fun linkCalendar(date: LocalDate): String = "mora://calendar?date=$date"
  }
}
