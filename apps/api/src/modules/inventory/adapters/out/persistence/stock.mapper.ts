import { SkuId } from '../../../../../shared/kernel/identifiers';
import { Quantity } from '../../../../../shared/kernel/quantity';
import { StockItem } from '../../../domain/stock-item';

export interface StockRow {
  skuId: string;
  onHand: number;
  reserved: number;
}

/**
 * 저장된 행 → 애그리거트.
 *
 * `SkuId.fromPersistence`를 쓴다 — `.of`는 깨진 행에 400을 내고 클라이언트에게
 * 거짓말한다 (계획 1의 M7). `Quantity.of`가 음수에 던지는 `InvalidQuantityError`는
 * 일반 `Error`라 500으로 가고, `StockItem.rehydrate`가 `reserved > onHand`를
 * `CorruptedStockError`(역시 일반 `Error`)로 잡는다.
 *
 * **`version` 컬럼을 읽지 않는다.** 도메인은 그런 컬럼이 있는지도 모르고,
 * 낙관적 어댑터가 자기 클로저에 따로 붙잡아 둔다.
 */
export function toStockDomain(row: StockRow): StockItem {
  return StockItem.rehydrate({
    skuId: SkuId.fromPersistence(row.skuId),
    onHand: Quantity.of(row.onHand),
    reserved: Quantity.of(row.reserved),
  });
}
