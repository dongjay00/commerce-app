import { productContract } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';
import { PRODUCT_ID, SKU_ID } from '../fixtures';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

describe('product MSW 핸들러', () => {
  it('목록 응답이 계약 스키마를 만족한다', async () => {
    const body = await (await fetch(`${BASE}/products`)).json();
    expect(() => productContract.search.responses[200].parse(body)).not.toThrow();
  });

  it('상세 응답이 계약 스키마를 만족하고 SKU를 담고 있다', async () => {
    const body = await (await fetch(`${BASE}/products/${PRODUCT_ID}`)).json();
    expect(() => productContract.get.responses[200].parse(body)).not.toThrow();
    expect(body.skus.map((sku: { id: string }) => sku.id)).toContain(SKU_ID);
  });
});
