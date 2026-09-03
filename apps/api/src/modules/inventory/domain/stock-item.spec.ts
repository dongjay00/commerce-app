import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { SkuId } from '../../../shared/kernel/identifiers';
import { Quantity } from '../../../shared/kernel/quantity';
import {
  CorruptedStockError,
  InsufficientStockError,
  StockCounterMismatchError,
} from './stock.errors';
import { StockItem } from './stock-item';

const DomainErrorConstructor = DomainError as unknown as new (...args: never[]) => Error;
const SKU = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c000001');
const q = (n: number) => Quantity.of(n);

function stock(onHand: number, reserved = 0): StockItem {
  return StockItem.rehydrate({ skuId: SKU, onHand: q(onHand), reserved: q(reserved) });
}

describe('StockItem.create', () => {
  it('예약 0으로 시작한다', () => {
    const item = StockItem.create({ skuId: SKU, onHand: q(10) });
    expect(item.onHand.value).toBe(10);
    expect(item.reserved.value).toBe(0);
    expect(item.available.value).toBe(10);
  });

  it('재고 0으로도 만들 수 있다', () => {
    // 품절 상태의 SKU도 재고 행은 존재해야 한다 — 없으면 "품절"과 "그런 SKU 없음"을
    // 구분할 수 없다.
    expect(StockItem.create({ skuId: SKU, onHand: q(0) }).available.value).toBe(0);
  });
});

describe('StockItem.available', () => {
  it('보유 - 예약이다', () => {
    expect(stock(10, 3).available.value).toBe(7);
  });

  it('전부 예약되면 0이다', () => {
    expect(stock(10, 10).available.value).toBe(0);
  });
});

describe('StockItem.reserve', () => {
  it('가용 재고 안에서 예약하면 reserved가 는다', () => {
    const item = stock(10);
    item.reserve(q(3));
    expect(item.reserved.value).toBe(3);
    expect(item.available.value).toBe(7);
    expect(item.onHand.value).toBe(10); // 예약은 아직 차감이 아니다
  });

  it('가용 재고를 정확히 다 쓰는 예약은 허용된다', () => {
    const item = stock(10, 4);
    item.reserve(q(6));
    expect(item.available.value).toBe(0);
  });

  it('가용 재고를 넘으면 InsufficientStockError다', () => {
    const item = stock(10, 8);
    expect(() => item.reserve(q(3))).toThrow(InsufficientStockError);
  });

  it('실패한 예약은 카운터를 바꾸지 않는다', () => {
    // 검사가 갱신보다 먼저 일어나야 한다. 순서가 뒤집히면 실패한 예약이
    // 재고를 갉아먹고, 그 손실은 TTL로도 회수되지 않는다(예약 행이 없으므로).
    const item = stock(10, 8);
    expect(() => item.reserve(q(3))).toThrow();
    expect(item.reserved.value).toBe(8);
  });

  it('InsufficientStockError는 DomainError다 — 사용자가 겪는 정상적인 경합 결과다', () => {
    const item = stock(1);
    expect(() => item.reserve(q(2))).toThrow(DomainErrorConstructor);
  });

  it('오류가 요청량과 가용량을 함께 담는다', () => {
    // 프론트가 "3개 요청, 1개 남음"을 보여주려면 둘 다 필요하다.
    const item = stock(1);
    const error = (() => {
      try {
        item.reserve(q(3));
        return null;
      } catch (caught) {
        return caught as InsufficientStockError;
      }
    })();
    expect(error?.requested.value).toBe(3);
    expect(error?.available.value).toBe(1);
    expect(error?.skuId).toBe(SKU);
  });
});

describe('StockItem.confirm', () => {
  it('예약을 실제 차감으로 바꾼다', () => {
    const item = stock(10, 3);
    item.confirm(q(3));
    expect(item.onHand.value).toBe(7);
    expect(item.reserved.value).toBe(0);
    expect(item.available.value).toBe(7);
  });

  it('예약의 일부만 확정할 수 있다', () => {
    const item = stock(10, 5);
    item.confirm(q(2));
    expect(item.onHand.value).toBe(8);
    expect(item.reserved.value).toBe(3);
  });

  it('예약보다 많이 확정하면 StockCounterMismatchError다 — DomainError가 아니다', () => {
    // 예약 행과 카운터가 어긋났다는 뜻이고 사용자가 고칠 수 없다.
    // Quantity.minus에 맡기면 NegativeQuantityError(409)가 나가는데 그 분류는 틀렸다.
    const item = stock(10, 2);
    expect(() => item.confirm(q(3))).toThrow(StockCounterMismatchError);
    expect(() => item.confirm(q(3))).not.toThrow(DomainErrorConstructor);
  });

  it('실패한 확정은 카운터를 바꾸지 않는다', () => {
    const item = stock(10, 2);
    expect(() => item.confirm(q(3))).toThrow();
    expect(item.onHand.value).toBe(10);
    expect(item.reserved.value).toBe(2);
  });
});

describe('StockItem.release', () => {
  it('예약을 되돌린다 — 보유량은 그대로다', () => {
    const item = stock(10, 3);
    item.release(q(3));
    expect(item.reserved.value).toBe(0);
    expect(item.onHand.value).toBe(10);
    expect(item.available.value).toBe(10);
  });

  it('예약보다 많이 해제하면 StockCounterMismatchError다', () => {
    const item = stock(10, 2);
    expect(() => item.release(q(3))).toThrow(StockCounterMismatchError);
  });
});

describe('StockItem.restock', () => {
  it('보유량을 늘린다', () => {
    const item = stock(10, 3);
    item.restock(q(5));
    expect(item.onHand.value).toBe(15);
    expect(item.available.value).toBe(12);
  });
});

describe('StockItem.rehydrate', () => {
  it('저장된 카운터를 그대로 복원한다', () => {
    const item = stock(10, 4);
    expect(item.onHand.value).toBe(10);
    expect(item.reserved.value).toBe(4);
  });

  it('예약이 보유량보다 큰 저장 행은 CorruptedStockError다', () => {
    // available이 음수인 재고는 존재할 수 없다. 도달했다면 데이터가 깨진 것이다.
    expect(() => StockItem.rehydrate({ skuId: SKU, onHand: q(3), reserved: q(5) })).toThrow(
      CorruptedStockError,
    );
  });

  it('CorruptedStockError는 DomainError가 아니다', () => {
    expect(() => StockItem.rehydrate({ skuId: SKU, onHand: q(3), reserved: q(5) })).not.toThrow(
      DomainErrorConstructor,
    );
  });
});
