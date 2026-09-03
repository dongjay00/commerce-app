import { describe, expect, it } from 'vitest';
import { ADD_ITEM_TO_CART_USECASE } from './in/add-item-to-cart.usecase';
import { CHANGE_CART_ITEM_QUANTITY_USECASE } from './in/change-cart-item-quantity.usecase';
import { REMOVE_ITEM_FROM_CART_USECASE } from './in/remove-item-from-cart.usecase';
import { CART_REPOSITORY } from './out/cart.repository';

/**
 * 포트 토큰의 정체성을 고정한다.
 *
 * 커버리지: 포트 파일은 인터페이스와 `Symbol` 하나가 전부라 `import type`으로만
 * 쓰이면 런타임에 로드되지 않고, Vitest의 `coverage.all`이 켜져 있어 0%로 잡혀
 * application 임계값(90/85)을 실패시킨다.
 *
 * 태스크 11~14가 포트를 더할 때마다 이 목록을 확장한다.
 */
describe('Ordering 포트 토큰', () => {
  const tokens: Array<{ token: symbol; name: string }> = [
    { token: CART_REPOSITORY, name: 'CartRepository' },
    { token: ADD_ITEM_TO_CART_USECASE, name: 'AddItemToCartUseCase' },
    { token: REMOVE_ITEM_FROM_CART_USECASE, name: 'RemoveItemFromCartUseCase' },
    { token: CHANGE_CART_ITEM_QUANTITY_USECASE, name: 'ChangeCartItemQuantityUseCase' },
  ];

  it.each(tokens)('$name 토큰은 심볼이고 설명이 포트 이름과 정확히 일치한다', ({ token, name }) => {
    expect(typeof token).toBe('symbol');
    expect(token.description).toBe(name);
  });

  it('토큰들은 서로 다르다', () => {
    expect(new Set(tokens.map((t) => t.token)).size).toBe(tokens.length);
  });
});
