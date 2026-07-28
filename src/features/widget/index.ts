/**
 * 안드로이드 홈 위젯 데이터 레이어 배럴.
 *
 *   import { useWidgetSync } from '@/features/widget';
 *
 * 네이티브 쪽(Kotlin·XML)의 정본은 `widgets/android/src/main/` 이고
 * `plugins/withMoraWidgets.js` 가 prebuild 때 `android/app/src/main/` 으로 복사한다.
 * 이 배럴은 **RN 이 위젯에 넘기는 JSON** 만 다룬다.
 */

export type {
  WidgetDocumentType,
  WidgetPayload,
  WidgetPayloadInput,
  WidgetUpcomingItem,
} from './data';
export {
  buildWidgetPayload,
  clearWidgetData,
  WIDGET_DATA_FILENAME,
  WIDGET_MONTH_RADIUS,
  WIDGET_PAYLOAD_VERSION,
  WIDGET_UPCOMING_LIMIT,
  widgetDataUri,
  writeWidgetData,
} from './data';
export { useWidgetSync } from './useWidgetSync';
