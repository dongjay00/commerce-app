/**
 * TTL이 지난 예약을 만료시켜 재고를 되돌린다.
 *
 * 스펙 §6.2의 5단계이고 "설계의 요체"로 불린 것이다: **보상 트랜잭션 자체가
 * 실패해도(서버가 죽어도) TTL이 결국 재고를 회복시킨다.** 그래서 이 유스케이스는
 * 다른 어떤 것에도 의존하지 않는다 — Ordering이 죽어 있어도, 이벤트가 유실돼도,
 * 결제 콜백이 영영 오지 않아도 재고는 돌아온다.
 */
export interface ExpireReservationsUseCase {
  /** 실제로 만료 처리한 건수를 돌려준다. */
  execute(): Promise<number>;
}

export const EXPIRE_RESERVATIONS_USECASE = Symbol('ExpireReservationsUseCase');
