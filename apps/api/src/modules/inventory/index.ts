import { InsufficientStockError, StockNotFoundError } from './domain/stock.errors';

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
  CONFIRM_RESERVATIONS_FOR_ORDER_USECASE,
  type ConfirmReservationsForOrderCommand,
  type ConfirmReservationsForOrderUseCase,
} from './application/ports/in/confirm-reservations-for-order.usecase';
export {
  RELEASE_RESERVATION_USECASE,
  type ReleaseReservationCommand,
  type ReleaseReservationUseCase,
} from './application/ports/in/release-reservation.usecase';
export {
  RELEASE_RESERVATIONS_FOR_ORDER_USECASE,
  type ReleaseReservationsForOrderCommand,
  type ReleaseReservationsForOrderUseCase,
} from './application/ports/in/release-reservations-for-order.usecase';
export {
  RESERVE_STOCK_USECASE,
  type ReserveStockCommand,
  type ReserveStockUseCase,
} from './application/ports/in/reserve-stock.usecase';
export {
  RESTORE_RESERVATIONS_FOR_ORDER_USECASE,
  type RestoreReservationsForOrderCommand,
  type RestoreReservationsForOrderUseCase,
} from './application/ports/in/restore-reservations-for-order.usecase';
export { InventoryModule } from './inventory.module';

/**
 * ACL이 구조적으로 판별할 때 쓰는 코드 문자열. **클래스가 아니라 값만 내보낸다** —
 * 예외 클래스를 내보내면 다른 컨텍스트가 우리 타입에 묶이고, 이 모듈을 별도
 * 프로세스로 떼어낼 때 그 클래스가 경계를 넘어야 한다.
 *
 * 출처가 하나여야 하는 이유: ordering이 `'INSUFFICIENT_STOCK'`을 복붙해 두면
 * 여기서 코드를 바꿀 때 조용히 어긋나고, 재고 부족이 409 대신 500으로 나간다.
 *
 * `index.ts`가 자기 도메인을 import하는 것은 규칙 위반이 아니다 —
 * `no-cross-module-internals`는 *다른* 모듈이 내부를 보는 것을 막는다.
 */
export const INSUFFICIENT_STOCK_CODE = InsufficientStockError.CODE;
export const STOCK_NOT_FOUND_CODE = StockNotFoundError.CODE;
