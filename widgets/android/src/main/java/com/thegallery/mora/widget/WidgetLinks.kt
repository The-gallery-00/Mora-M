// 위젯에서 나가는 두 종류의 PendingIntent 를 만든다.
//   1. 딥링크 → 앱 액티비티 (ACTION_VIEW + mora://…)
//   2. 자체 브로드캐스트 → provider 자신 (월 이동 / 새로고침)
//
// FLAG_IMMUTABLE 필수: API 31+ 는 mutable/immutable 을 명시하지 않은 PendingIntent 생성 시
// IllegalArgumentException 을 던진다. 위젯은 extras 를 남에게 채워 넣게 할 이유가 없으므로 전부 immutable 이다.
//
// requestCode 와 data 를 위젯 id·용도별로 다르게 주는 이유: `Intent.filterEquals` 는 **extras 를 보지 않는다**.
// action 이 같고 delta 만 다른 인텐트는 requestCode·data 까지 같으면 하나로 접혀
// 이전/다음 버튼이 같은 방향으로 동작한다.
package com.thegallery.mora.widget

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log

private const val TAG = "MoraWidget"

/** 위젯 → 앱 딥링크. `setPackage` 로 다른 앱이 `mora://` 를 가로채는 것을 막는다. */
internal fun deepLinkPendingIntent(
  context: Context,
  uri: String,
  requestCode: Int,
): PendingIntent? {
  return try {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
      // dev 변형에서는 이 값이 com.thegallery.mora.dev 라 자기 자신으로 정확히 향한다.
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  } catch (t: Throwable) {
    Log.w(TAG, "딥링크 PendingIntent 실패: $uri", t)
    null
  }
}

/**
 * provider 자신에게 보내는 명시적 브로드캐스트.
 * 명시적 인텐트라 매니페스트 `<intent-filter>` 에 이 action 을 등록하지 않아도 전달된다
 * (그래서 외부에서 이 action 으로 우리 리시버를 깨울 수 없다).
 */
internal fun selfBroadcastPendingIntent(
  context: Context,
  target: Class<*>,
  action: String,
  requestCode: Int,
  discriminator: String,
  extras: Map<String, Int> = emptyMap(),
  flags: Map<String, Boolean> = emptyMap(),
): PendingIntent? {
  return try {
    val intent = Intent(action).apply {
      component = ComponentName(context, target)
      // extras 는 filterEquals 에서 무시되므로 구분용 data 를 넣어 접힘을 막는다.
      data = Uri.parse("mora-widget://$discriminator")
      for ((key, value) in extras) putExtra(key, value)
      for ((key, value) in flags) putExtra(key, value)
    }
    PendingIntent.getBroadcast(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  } catch (t: Throwable) {
    Log.w(TAG, "브로드캐스트 PendingIntent 실패: $action", t)
    null
  }
}
