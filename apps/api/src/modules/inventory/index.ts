/**
 * inventory 컨텍스트의 공개 API. 다른 모듈은 **이 파일만** import할 수 있다
 * (`no-cross-module-internals`가 강제한다).
 *
 * 스펙 §7.5는 `ReserveStockUseCase`를 "ordering이 포트 통해 호출"한다고 적었다.
 * 계획 4의 `InProcessInventoryAdapter`가 부를 대상이 이 셋이고,
 * `Confirm`/`Release`는 그 어댑터가 이벤트 구독으로 사가를 진행시킬 때 쓴다.
 *
 * **`StockRepository`는 내보내지 않는다.** 다른 모듈이 우리 애그리거트를 직접
 * 만지면 `reserved ≤ onHand` 불변식의 주인이 사라진다.
 */
export {
  CONFIRM_RESERVATION_USECASE,
  type ConfirmReservationCommand,
  type ConfirmReservationUseCase,
} from './application/ports/in/confirm-reservation.usecase';
export {
  RELEASE_RESERVATION_USECASE,
  type ReleaseReservationCommand,
  type ReleaseReservationUseCase,
} from './application/ports/in/release-reservation.usecase';
export {
  RESERVE_STOCK_USECASE,
  type ReserveStockCommand,
  type ReserveStockUseCase,
} from './application/ports/in/reserve-stock.usecase';
export { InventoryModule } from './inventory.module';
