import { describe, expect, it } from 'vitest';
import { InvalidMoneyError } from '../../../../shared/kernel/money';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import {
  DuplicateSkuCodeError,
  InvalidPriceError,
  InvalidProductError,
} from '../../domain/catalog.errors';
import { FIXED_NOW } from '../../testing/catalog.fixtures';
import { InMemoryProductRepository } from '../../testing/in-memory-product.repository';
import { RegisterProductService } from './register-product.service';

function build() {
  const products = new InMemoryProductRepository();
  const clock = new MutableClock(FIXED_NOW);
  const ids = new SequentialIdGenerator();
  const service = new RegisterProductService(
    products,
    new PassthroughTransactionManager(),
    clock,
    ids,
  );
  return { service, products, clock, ids };
}

const COMMAND = {
  name: '티셔츠',
  skus: [
    { code: 'RED-M', price: { amount: '1000', currency: 'KRW' as const } },
    { code: 'RED-L', price: { amount: '1200', currency: 'KRW' as const } },
  ],
};

describe('RegisterProductService', () => {
  it('상품과 SKU가 저장되고 productId가 돌아온다', async () => {
    const { service, products } = build();
    const { productId } = await service.execute(COMMAND);

    const saved = await products.findById(productId as never);
    expect(saved?.name).toBe('티셔츠');
    expect(saved?.skus).toHaveLength(2);
  });

  it('생성 시각이 주입된 Clock의 값이다', async () => {
    const { service, products } = build();
    const { productId } = await service.execute(COMMAND);
    expect((await products.findById(productId as never))?.createdAt).toEqual(FIXED_NOW);
  });

  it('SKU ID가 주입된 IdGenerator에서 나온다', async () => {
    // 순번 fake라 값을 단언할 수 있다. new UuidV7()을 직접 부르면 여기서 깨진다.
    const { service, products } = build();
    const { productId } = await service.execute(COMMAND);
    const saved = await products.findById(productId as never);
    expect(saved?.skus.map((s) => s.id)).toEqual([
      '00000000-0000-7000-8000-000000000001',
      '00000000-0000-7000-8000-000000000002',
    ]);
    expect(productId).toBe('00000000-0000-7000-8000-000000000003');
  });

  it('가격 DTO의 문자열 금액이 bigint로 변환돼 저장된다', async () => {
    const { service, products } = build();
    const { productId } = await service.execute(COMMAND);
    const saved = await products.findById(productId as never);
    expect(saved?.skus[0]?.price.money.amount).toBe(1000n);
  });

  it('빈 이름이면 InvalidProductError이고 아무것도 저장되지 않는다', async () => {
    const { service, products } = build();
    await expect(service.execute({ ...COMMAND, name: '   ' })).rejects.toThrow(InvalidProductError);
    expect(await products.findAll()).toEqual([]);
  });

  it('SKU 코드가 중복이면 DuplicateSkuCodeError이고 아무것도 저장되지 않는다', async () => {
    const { service, products } = build();
    await expect(
      service.execute({
        name: '티셔츠',
        skus: [
          { code: 'SAME', price: { amount: '1000', currency: 'KRW' } },
          { code: 'SAME', price: { amount: '1200', currency: 'KRW' } },
        ],
      }),
    ).rejects.toThrow(DuplicateSkuCodeError);
    expect(await products.findAll()).toEqual([]);
  });

  it('0원 가격이면 InvalidPriceError이고 아무것도 저장되지 않는다', async () => {
    const { service, products } = build();
    await expect(
      service.execute({
        name: '티셔츠',
        skus: [{ code: 'FREE', price: { amount: '0', currency: 'KRW' } }],
      }),
    ).rejects.toThrow(InvalidPriceError);
    expect(await products.findAll()).toEqual([]);
  });

  it('정규화되지 않은 금액 문자열은 InvalidMoneyError다', async () => {
    // '007' 같은 선행 0은 Money.fromDto가 거부한다 — 계획 1이 정한 표준이다.
    const { service } = build();
    await expect(
      service.execute({
        name: '티셔츠',
        skus: [{ code: 'X', price: { amount: '007', currency: 'KRW' } }],
      }),
    ).rejects.toThrow(InvalidMoneyError);
  });
});
