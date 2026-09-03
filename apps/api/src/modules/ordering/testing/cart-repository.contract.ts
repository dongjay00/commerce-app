import { describe, expect, it } from 'vitest';
import { CartId, CustomerId, SkuId } from '../../../shared/kernel/identifiers';
import { Quantity } from '../../../shared/kernel/quantity';
import type { CartRepository } from '../application/ports/out/cart.repository';
import { Cart } from '../domain/cart/cart';
import { cartUuid, customerUuid, skuUuid } from './ordering.fixtures';

/**
 * CartRepository 계약. **같은 스위트가 in-memory와 Prisma 양쪽에서 통과해야 한다**
 * (스펙 §9.2).
 */
export function cartRepositoryContract(
  name: string,
  createRepo: () => Promise<CartRepository>,
): void {
  describe(`CartRepository 계약 — ${name}`, () => {
    const make = (suffix: string): Cart =>
      Cart.create({
        id: CartId.of(cartUuid(suffix)),
        customerId: CustomerId.of(customerUuid(suffix)),
      });

    it('없는 고객의 장바구니는 null이다', async () => {
      const repo = await createRepo();
      expect(await repo.findByCustomerId(CustomerId.of(customerUuid('99')))).toBeNull();
    });

    it('저장한 장바구니를 고객 id로 찾는다', async () => {
      const repo = await createRepo();
      const cart = make('1');
      cart.addItem(SkuId.of(skuUuid('1')), Quantity.positive(2));
      await repo.save(cart);

      const found = await repo.findByCustomerId(CustomerId.of(customerUuid('1')));
      expect(found?.id).toBe(cartUuid('1'));
      expect(found?.lines).toHaveLength(1);
      expect(found?.lines[0]?.quantity.value).toBe(2);
    });

    it('줄을 추가하면 저장된다', async () => {
      const repo = await createRepo();
      const cart = make('2');
      cart.addItem(SkuId.of(skuUuid('1')), Quantity.positive(1));
      await repo.save(cart);

      cart.addItem(SkuId.of(skuUuid('2')), Quantity.positive(3));
      await repo.save(cart);

      const found = await repo.findByCustomerId(CustomerId.of(customerUuid('2')));
      expect(found?.lines).toHaveLength(2);
    });

    it('줄을 빼면 저장본에서도 사라진다', async () => {
      // save가 append-only면 이 테스트가 실패한다. 장바구니는 통째로 갈아끼워야 한다.
      const repo = await createRepo();
      const cart = make('3');
      cart.addItem(SkuId.of(skuUuid('1')), Quantity.positive(1));
      cart.addItem(SkuId.of(skuUuid('2')), Quantity.positive(1));
      await repo.save(cart);

      cart.removeItem(SkuId.of(skuUuid('1')));
      await repo.save(cart);

      const found = await repo.findByCustomerId(CustomerId.of(customerUuid('3')));
      expect(found?.lines.map((line) => line.skuId)).toEqual([skuUuid('2')]);
    });

    it('수량 변경이 저장된다', async () => {
      const repo = await createRepo();
      const cart = make('4');
      cart.addItem(SkuId.of(skuUuid('1')), Quantity.positive(1));
      await repo.save(cart);

      cart.changeQuantity(SkuId.of(skuUuid('1')), Quantity.positive(9));
      await repo.save(cart);

      const found = await repo.findByCustomerId(CustomerId.of(customerUuid('4')));
      expect(found?.lines[0]?.quantity.value).toBe(9);
    });

    it('빈 장바구니도 저장되고 복원된다', async () => {
      // clear() 후 저장하면 줄이 0개인 장바구니가 남는다. 그것이 null과 구분돼야
      // "장바구니는 있는데 비었다"와 "장바구니가 없다"를 클라이언트가 구분할 수 있다.
      const repo = await createRepo();
      const cart = make('5');
      cart.addItem(SkuId.of(skuUuid('1')), Quantity.positive(1));
      await repo.save(cart);

      cart.clear();
      await repo.save(cart);

      const found = await repo.findByCustomerId(CustomerId.of(customerUuid('5')));
      expect(found).not.toBeNull();
      expect(found?.isEmpty).toBe(true);
    });

    it('삭제하면 null이 된다', async () => {
      const repo = await createRepo();
      await repo.save(make('6'));
      await repo.delete(CartId.of(cartUuid('6')));
      expect(await repo.findByCustomerId(CustomerId.of(customerUuid('6')))).toBeNull();
    });

    it('없는 장바구니를 지워도 던지지 않는다', async () => {
      // 주문이 두 번 처리돼도(at-least-once) 두 번째 삭제가 실패하면 안 된다.
      const repo = await createRepo();
      await expect(repo.delete(CartId.of(cartUuid('98')))).resolves.toBeUndefined();
    });

    it('돌려준 장바구니를 바꿔도 저장본은 바뀌지 않는다', async () => {
      const repo = await createRepo();
      await repo.save(make('7'));

      const first = await repo.findByCustomerId(CustomerId.of(customerUuid('7')));
      first?.addItem(SkuId.of(skuUuid('1')), Quantity.positive(5));

      const second = await repo.findByCustomerId(CustomerId.of(customerUuid('7')));
      expect(second?.lines).toHaveLength(0);
    });
  });
}
