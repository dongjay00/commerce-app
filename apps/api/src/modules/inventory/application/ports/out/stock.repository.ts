import type { SkuId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { StockItem } from '../../../domain/stock-item';

export interface StockRepository {
  /**
   * `skuId`의 재고를 읽어 `change`를 적용하고 저장한 뒤, `change`의 반환값을 돌려준다.
   *
   * **읽기-수정-쓰기 한 사이클을 통째로 어댑터가 소유한다.** 이 형태가 아니면
   * 낙관적 재시도를 어댑터 안에 가둘 수 없다 — 버전이 충돌하면 다시 읽고 도메인
   * 판단을 다시 해야 하는데, `save`만 재시도하면 낡은 데이터로 내린 결정을 그대로
   * 다시 쓰게 된다. 재시도를 유스케이스로 올리면 락 전략이 애플리케이션으로 샌다.
   *
   * `change`가 던지면 아무것도 저장되지 않는다. 재고 부족으로 예약이 거절되는 경로가
   * 그것이다.
   *
   * `tx`가 필수인 이유: 재고 카운터 갱신과 예약 행 생성은 같은 트랜잭션이어야 한다.
   * 갈라지면 카운터와 예약이 어긋나고, 그 손상은 `StockCounterMismatchError`(500)로만
   * 드러난다. 비관적 어댑터의 `SELECT ... FOR UPDATE`도 트랜잭션 밖에서는 잠금이
   * 문장 종료 즉시 풀려 아무것도 지키지 못한다.
   */
  mutate<T>(skuId: SkuId, tx: TransactionContext, change: (stock: StockItem) => T): Promise<T>;

  /** 조회 전용. 잠그지 않는다. */
  findBySkuId(skuId: SkuId, tx?: TransactionContext): Promise<StockItem | null>;

  /** 초기 시딩. 이미 있으면 던진다. */
  create(stock: StockItem, tx?: TransactionContext): Promise<void>;
}

export const STOCK_REPOSITORY = Symbol('StockRepository');
