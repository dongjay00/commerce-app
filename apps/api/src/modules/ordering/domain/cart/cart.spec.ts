import { describe, expect, it } from 'vitest';
import { CartId, CustomerId, SkuId } from '../../../../shared/kernel/identifiers';
import { Quantity, QuantityBelowMinimumError } from '../../../../shared/kernel/quantity';
import { cartUuid, customerUuid, skuUuid } from '../../testing/ordering.fixtures';
import { Cart } from './cart';
import { CartLineLimitExceededError, CartLineNotFoundError } from './cart.errors';
import { CartLine } from './cart-line';

const SKU_A = SkuId.of(skuUuid('1'));
const SKU_B = SkuId.of(skuUuid('2'));

const empty = (): Cart =>
  Cart.create({ id: CartId.of(cartUuid('1')), customerId: CustomerId.of(customerUuid('1')) });

describe('Cart.addItem', () => {
  it('새 SKU를 담으면 줄이 생긴다', () => {
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(2));

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity.value).toBe(2);
  });

  it('같은 SKU를 다시 담으면 수량이 합쳐진다', () => {
    // 같은 SKU가 두 줄로 들어가지 않는다 — 스펙 §5.1의 Cart 불변식이다.
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(2));
    cart.addItem(SKU_A, Quantity.positive(3));

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity.value).toBe(5);
  });

  it('수량 0으로는 담을 수 없다', () => {
    // Quantity.positive가 막는다. 0개를 담는 것은 줄 자체가 없어야 한다는 뜻이다.
    expect(() => empty().addItem(SKU_A, Quantity.positive(0))).toThrow(QuantityBelowMinimumError);
  });

  it('20종류를 넘기면 CartLineLimitExceededError다', () => {
    // 상한이 없으면 주문 시점에 그 수만큼 예약 트랜잭션이 열린다(태스크 12).
    const cart = empty();
    for (let i = 1; i <= 20; i += 1) {
      cart.addItem(SkuId.of(skuUuid(String(i))), Quantity.positive(1));
    }
    expect(() => cart.addItem(SkuId.of(skuUuid('21')), Quantity.positive(1))).toThrow(
      CartLineLimitExceededError,
    );
  });

  it('이미 담긴 SKU는 상한을 넘지 않는다', () => {
    // 수량 합치기는 줄을 늘리지 않으므로 상한과 무관해야 한다.
    const cart = empty();
    for (let i = 1; i <= 20; i += 1) {
      cart.addItem(SkuId.of(skuUuid(String(i))), Quantity.positive(1));
    }
    expect(() => cart.addItem(SkuId.of(skuUuid('1')), Quantity.positive(1))).not.toThrow();
    expect(cart.lines).toHaveLength(20);
  });
});

describe('Cart.changeQuantity', () => {
  it('수량을 바꾼다', () => {
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(2));
    cart.changeQuantity(SKU_A, Quantity.positive(7));

    expect(cart.lines[0]?.quantity.value).toBe(7);
  });

  it('없는 SKU의 수량을 바꾸면 CartLineNotFoundError다', () => {
    expect(() => empty().changeQuantity(SKU_A, Quantity.positive(1))).toThrow(
      CartLineNotFoundError,
    );
  });

  it('다른 줄은 건드리지 않는다', () => {
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(2));
    cart.addItem(SKU_B, Quantity.positive(3));
    cart.changeQuantity(SKU_A, Quantity.positive(9));

    expect(cart.lines.find((line) => line.skuId === SKU_B)?.quantity.value).toBe(3);
  });
});

describe('Cart.removeItem', () => {
  it('줄을 뺀다', () => {
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(2));
    cart.addItem(SKU_B, Quantity.positive(1));
    cart.removeItem(SKU_A);

    expect(cart.lines.map((line) => line.skuId)).toEqual([SKU_B]);
  });

  it('없는 SKU를 빼면 CartLineNotFoundError다', () => {
    // 조용히 넘어가면 클라이언트가 UI를 잘못 그리고 있다는 사실이 드러나지 않는다.
    expect(() => empty().removeItem(SKU_A)).toThrow(CartLineNotFoundError);
  });
});

describe('Cart.clear', () => {
  it('주문이 만들어지면 장바구니를 비운다', () => {
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(2));
    cart.clear();

    expect(cart.isEmpty).toBe(true);
    expect(cart.lines).toHaveLength(0);
  });
});

describe('Cart.lines 캡슐화', () => {
  it('돌려준 배열을 바꿔도 장바구니는 바뀌지 않는다', () => {
    // 애그리거트 밖으로 내부 배열이 새면 불변식(중복 없음·상한)이 우회된다.
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(1));

    (cart.lines as CartLine[]).push(new CartLine(SKU_B, Quantity.positive(1)));

    expect(cart.lines).toHaveLength(1);
  });
});
