import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../../shared/kernel/domain-error';
import { SkuId } from '../../../../shared/kernel/identifiers';
import { InvalidQuantityError } from '../../../../shared/kernel/quantity';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { StockAlreadyExistsError } from '../../domain/stock.errors';
import { InMemoryStockRepository } from '../../testing/in-memory-stock.repository';
import { skuUuid } from '../../testing/inventory.fixtures';
import { RegisterStockService } from './register-stock.service';

const SKU = skuUuid('1');

function build() {
  const stocks = new InMemoryStockRepository();
  return { stocks, service: new RegisterStockService(stocks, new PassthroughTransactionManager()) };
}

describe('RegisterStockService', () => {
  it('재고 행을 만든다', async () => {
    const { service, stocks } = build();

    await service.execute({ skuId: SKU, onHand: 10 });

    const stock = await stocks.findBySkuId(SkuId.of(SKU));
    expect(stock?.onHand.value).toBe(10);
    expect(stock?.reserved.value).toBe(0);
  });

  it('보유량 0으로 등록할 수 있다', async () => {
    // 품절 상태로 상품을 열어두는 것은 정상이다. 입고(Restock)와 다른 점이다.
    const { service, stocks } = build();

    await service.execute({ skuId: SKU, onHand: 0 });

    expect((await stocks.findBySkuId(SkuId.of(SKU)))?.onHand.value).toBe(0);
  });

  it('음수 보유량은 InvalidQuantityError다 — DomainError가 아니라 500이다', async () => {
    // `Quantity.of`는 이름과 달리 **인바운드 팩토리가 아니다.** 음수에 평문 `Error`인
    // `InvalidQuantityError`를 던지고, 그것은 500으로 나간다. 인바운드 검증은
    // `stockContract`의 `z.number().int().nonnegative()`가 맡고(400), 여기까지
    // 음수가 도달했다면 그건 사용자 입력이 아니라 호출자의 버그다.
    //
    // 0 이상을 허용하면서 `DomainError`를 내는 팩토리가 커널에 없다 —
    // `positive`는 0을 거부하고 `of`는 500을 낸다. 재고 등록에는 0이 정상이므로
    // 이 조합이 최선이고, 그물이 계약과 커널 둘로 나뉜 것을 여기 적어둔다.
    const { service } = build();
    const error = await service.execute({ skuId: SKU, onHand: -1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidQuantityError);
    expect(error).not.toBeInstanceOf(DomainError);
  });

  it('같은 SKU를 두 번 등록하면 StockAlreadyExistsError다', async () => {
    const { service } = build();
    await service.execute({ skuId: SKU, onHand: 10 });

    await expect(service.execute({ skuId: SKU, onHand: 99 })).rejects.toThrow(
      StockAlreadyExistsError,
    );
  });
});
