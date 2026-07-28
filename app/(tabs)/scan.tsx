// app/(tabs)/scan.tsx
//
// 탭바 중앙 스캔 슬롯의 **플레이스홀더**다 (Navigation Map §1 · §3).
//
// 이 화면은 렌더되지 않는다. `(tabs)/_layout.tsx` 의 `tabPress` 리스너가 `preventDefault()` 로
// 탭 전환을 막고 `/scan`(fullScreenModal 스택)을 push 하기 때문이다.
// 파일 자체가 필요한 이유는 expo-router 가 실제 라우트 파일이 있는 슬롯에만
// `<Tabs.Screen name="scan">` 을 허용하기 때문이다.
export default function ScanTabPlaceholder() {
  return null;
}
