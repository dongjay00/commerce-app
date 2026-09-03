/**
 * ordering 컨텍스트의 공개 API.
 *
 * **`OrderingModule`만 내보낸다.** ordering은 Core이고 아무도 그것을 부르지 않는다 —
 * 역방향(재고 확정, 환불 완료, 예약 만료)은 전부 이벤트다(스펙 §4.1). 직접 호출을
 * 허용하면 순환 참조가 생기고 `no-circular`가 막는다.
 */
export { OrderingModule } from './ordering.module';
