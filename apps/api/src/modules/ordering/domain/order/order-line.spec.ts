import { describe, expect, it } from 'vitest';
import { SkuId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import { Quantity } from '../../../../shared/kernel/quantity';
import { skuUuid } from '../../testing/ordering.fixtures';
import { OrderLine } from './order-line';

const line = (amount: bigint, qty: number): OrderLine =>
  OrderLine.of({
    skuId: SkuId.of(skuUuid('1')),
    nameSnapshot: '티셔츠 RED-M',
    unitPrice: Money.of(amount),
    quantity: Quantity.positive(qty),
  });

describe('OrderLine', () => {
  it('소계는 단가 × 수량이다', () => {
    // Money.multiply(Quantity) — 태스크 1이 추가한 오버로드의 첫 사용처다.
    expect(line(1200n, 3).subtotal.amount).toBe(3600n);
  });

  it('이름 스냅샷의 앞뒤 공백을 다듬는다', () => {
    const trimmed = OrderLine.of({
      skuId: SkuId.of(skuUuid('1')),
      nameSnapshot: '  티셔츠  ',
      unitPrice: Money.of(1000n),
      quantity: Quantity.positive(1),
    });
    expect(trimmed.nameSnapshot).toBe('티셔츠');
  });

  it('수량 0으로는 만들 수 없다', () => {
    expect(() =>
      OrderLine.of({
        skuId: SkuId.of(skuUuid('1')),
        nameSnapshot: '티셔츠',
        unitPrice: Money.of(1000n),
        quantity: Quantity.of(0),
      }),
    ).toThrow(/수량은 1개 이상/);
  });

  it('이름 스냅샷이 비어 있으면 만들 수 없다', () => {
    // 이름이 없으면 주문 내역이 "무엇을 샀는지"를 말하지 못한다.
    expect(() =>
      OrderLine.of({
        skuId: SkuId.of(skuUuid('1')),
        nameSnapshot: '   ',
        unitPrice: Money.of(1000n),
        quantity: Quantity.positive(1),
      }),
    ).toThrow(/이름/);
  });

  it('단가가 0 이하면 만들 수 없다', () => {
    expect(() =>
      OrderLine.of({
        skuId: SkuId.of(skuUuid('1')),
        nameSnapshot: '티셔츠',
        unitPrice: Money.zero(),
        quantity: Quantity.positive(1),
      }),
    ).toThrow(/단가/);
  });

  it('fromPersistence는 손상된 값에 "저장된"이라고 말한다', () => {
    // of와 fromPersistence 둘 다 평문 Error(500)이지만 메시지가 다르다 —
    // 로그에서 원인이 인바운드인지 저장 데이터인지 구분되어야 한다.
    expect(() =>
      OrderLine.fromPersistence({
        skuId: SkuId.fromPersistence(skuUuid('1')),
        nameSnapshot: '',
        unitPrice: Money.of(1000n),
        quantity: Quantity.of(1),
      }),
    ).toThrow(/저장된/);
  });

  it('fromPersistence는 손상된 수량에도 던진다', () => {
    expect(() =>
      OrderLine.fromPersistence({
        skuId: SkuId.fromPersistence(skuUuid('1')),
        nameSnapshot: '티셔츠',
        unitPrice: Money.of(1000n),
        quantity: Quantity.of(0),
      }),
    ).toThrow(/저장된 주문 라인이 손상/);
  });
});
