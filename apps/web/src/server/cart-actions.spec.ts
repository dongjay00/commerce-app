import { ErrorCode } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { SKU_ID } from '../shared/api/msw/fixtures';
import { server } from '../shared/api/msw/server';
import { SessionExpiredError } from './api-client';
import { addCartItemAction, changeCartItemAction, removeCartItemAction } from './cart-actions';
import { InMemoryTokenStore } from './testing/in-memory-token-store';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

const deps = (
  tokens: { accessToken: string; refreshToken: string } | null = {
    accessToken: 'a',
    refreshToken: 'r',
  },
) => ({ baseUrl: BASE, store: new InMemoryTokenStore(tokens) });

describe('addCartItemAction', () => {
  it('성공하면 ok: true다', async () => {
    const result = await addCartItemAction({ skuId: SKU_ID, quantity: 2 }, deps());
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('액세스 토큰을 헤더에 싣는다', async () => {
    // 이것이 BFF의 존재 이유다 — 브라우저는 토큰을 보지 않는다(스펙 §8.5).
    let seen: string | null = null;
    server.use(
      http.post(`${BASE}/cart/items`, ({ request }) => {
        seen = request.headers.get('authorization');
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await addCartItemAction({ skuId: SKU_ID, quantity: 1 }, deps());

    expect(seen).toBe('Bearer a');
  });

  it('재고 부족이면 code로 분기할 수 있다', async () => {
    server.use(
      http.post(`${BASE}/cart/items`, () =>
        HttpResponse.json(
          { code: ErrorCode.INSUFFICIENT_STOCK, message: '재고 부족: 018f' },
          { status: 409 },
        ),
      ),
    );

    const result = await addCartItemAction({ skuId: SKU_ID, quantity: 1 }, deps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.INSUFFICIENT_STOCK);
    }
  });

  it('세션이 없으면 SessionExpiredError다', async () => {
    // 호출자(Route Handler)가 이걸 잡아 401로 바꾼다.
    await expect(addCartItemAction({ skuId: SKU_ID, quantity: 1 }, deps(null))).rejects.toThrow(
      SessionExpiredError,
    );
  });
});

describe('changeCartItemAction', () => {
  it('경로에 skuId를 넣는다', async () => {
    let seenUrl: string | null = null;
    server.use(
      http.put(`${BASE}/cart/items/:skuId`, ({ request }) => {
        seenUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await changeCartItemAction(SKU_ID, { quantity: 5 }, deps());

    expect(seenUrl).toContain(`/cart/items/${SKU_ID}`);
  });

  it('없는 줄이면 NOT_FOUND로 분기할 수 있다', async () => {
    server.use(
      http.put(`${BASE}/cart/items/:skuId`, () =>
        HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'x' }, { status: 404 }),
      ),
    );

    const result = await changeCartItemAction(SKU_ID, { quantity: 5 }, deps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.NOT_FOUND);
    }
  });
});

describe('removeCartItemAction', () => {
  it('성공하면 ok: true다', async () => {
    expect(await removeCartItemAction(SKU_ID, deps())).toEqual({ ok: true, data: undefined });
  });
});
