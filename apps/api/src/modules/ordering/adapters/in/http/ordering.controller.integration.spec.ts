import { cartContract, ErrorCode, orderContract } from '@commerce/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workerDatabaseName } from '../../../../../../test/setup/database';
import { AppModule } from '../../../../../app.module';

let app: INestApplication;
const originalDatabaseUrl = process.env['DATABASE_URL'];

beforeAll(async () => {
  process.env['DATABASE_URL'] = `${process.env['TEST_DATABASE_BASE_URL']}/${workerDatabaseName()}`;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
  // process.env는 워커 단위라 복원하지 않으면 같은 워커의 이후 spec이 상속한다.
  if (originalDatabaseUrl === undefined) {
    delete process.env['DATABASE_URL'];
  } else {
    process.env['DATABASE_URL'] = originalDatabaseUrl;
  }
});

const sku = (suffix: string): string => `018f2b1c-4a5d-7e6f-8a9b-0e1ccc${suffix.padStart(6, '0')}`;

async function signUp(email: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/auth/sign-up')
    .send({ email, password: 'correct horse battery staple' });
  return response.body.accessToken as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('장바구니 HTTP', () => {
  it('장바구니가 없어도 200이고 빈 뷰다', async () => {
    // 처음 방문한 고객이 빈 장바구니 화면을 볼 수 있어야 한다.
    const token = await signUp('cart1@example.com');

    const response = await request(app.getHttpServer()).get('/cart').set(auth(token));

    expect(response.status).toBe(200);
    // 서버를 자기 계약에 묶는다.
    expect(() => cartContract.get.responses[200].parse(response.body)).not.toThrow();
    expect(response.body).toEqual({
      cartId: null,
      lines: [],
      total: { amount: '0', currency: 'KRW' },
      unavailableSkuIds: [],
    });
  });

  it('담으면 204이고 조회에 줄이 생긴다 — Catalog가 모르면 unavailable로 간다', async () => {
    const token = await signUp('cart2@example.com');

    const added = await request(app.getHttpServer())
      .post('/cart/items')
      .set(auth(token))
      .send({ skuId: sku('1'), quantity: 2 });
    expect(added.status).toBe(204);

    const cart = await request(app.getHttpServer()).get('/cart').set(auth(token));
    expect(cart.status).toBe(200);
    // Catalog에 등록되지 않은 SKU이므로 줄이 아니라 unavailable에 담긴다.
    expect(cart.body.unavailableSkuIds).toEqual([sku('1')]);
  });

  it('수량을 바꾸면 204다', async () => {
    const token = await signUp('cart3@example.com');
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(auth(token))
      .send({ skuId: sku('1'), quantity: 1 });

    const response = await request(app.getHttpServer())
      .put(`/cart/items/${sku('1')}`)
      .set(auth(token))
      .send({ quantity: 5 });

    expect(response.status).toBe(204);
  });

  it('없는 줄의 수량을 바꾸면 404다', async () => {
    const token = await signUp('cart4@example.com');
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(auth(token))
      .send({ skuId: sku('1'), quantity: 1 });

    const response = await request(app.getHttpServer())
      .put(`/cart/items/${sku('9')}`)
      .set(auth(token))
      .send({ quantity: 5 });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('장바구니가 없는데 빼면 404다', async () => {
    const token = await signUp('cart5@example.com');

    const response = await request(app.getHttpServer())
      .delete(`/cart/items/${sku('1')}`)
      .set(auth(token));

    expect(response.status).toBe(404);
  });

  it('수량 0으로 담으면 400 VALIDATION_FAILED다', async () => {
    const token = await signUp('cart6@example.com');

    const response = await request(app.getHttpServer())
      .post('/cart/items')
      .set(auth(token))
      .send({ skuId: sku('1'), quantity: 0 });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('토큰 없이 부르면 401이다', async () => {
    const response = await request(app.getHttpServer()).get('/cart');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });
});

describe('주문 HTTP', () => {
  it('빈 장바구니로 주문하면 422다', async () => {
    const token = await signUp('order1@example.com');
    // 주소를 먼저 만든다 — 그래야 실패 원인이 장바구니임이 분명해진다.
    const address = await request(app.getHttpServer()).post('/addresses').set(auth(token)).send({
      label: '집',
      recipient: '홍길동',
      phone: '010-1234-5678',
      zip: '06236',
      line1: '서울시 강남구 테헤란로 1',
    });

    expect(address.status, JSON.stringify(address.body)).toBe(201);

    const response = await request(app.getHttpServer())
      .post('/orders')
      .set(auth(token))
      .send({ addressId: address.body.id });

    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.code).toBe(ErrorCode.DOMAIN_RULE_VIOLATED);
  });

  it('없는 주문을 조회하면 404다', async () => {
    const token = await signUp('order2@example.com');

    const response = await request(app.getHttpServer())
      .get('/orders/018f2b1c-4a5d-7e6f-8a9b-0e1b00999999')
      .set(auth(token));

    expect(response.status).toBe(404);
    expect(response.body.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('경로 파라미터가 uuid가 아니면 400이다', async () => {
    const token = await signUp('order3@example.com');
    const response = await request(app.getHttpServer()).get('/orders/not-a-uuid').set(auth(token));
    expect(response.status).toBe(400);
  });

  it('주문 목록은 200이고 계약 형태다', async () => {
    const token = await signUp('order4@example.com');

    const response = await request(app.getHttpServer()).get('/orders').set(auth(token));

    expect(response.status).toBe(200);
    expect(() => orderContract.list.responses[200].parse(response.body)).not.toThrow();
    expect(response.body.orders).toEqual([]);
  });

  it('목록 limit이 100을 넘으면 400이다', async () => {
    // Zod가 막는다. 서비스의 Math.min은 두 번째 그물이다.
    const token = await signUp('order5@example.com');

    const response = await request(app.getHttpServer()).get('/orders?limit=5000').set(auth(token));

    expect(response.status).toBe(400);
  });

  it('토큰 없이 주문하면 401이다', async () => {
    const response = await request(app.getHttpServer())
      .post('/orders')
      .send({ addressId: '018f2b1c-4a5d-7e6f-8a9b-0e1e00000001' });
    expect(response.status).toBe(401);
  });
});
