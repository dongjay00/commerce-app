import { ErrorCode, stockContract } from '@commerce/contracts';
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

const sku = (suffix: string): string => `018f2b1c-4a5d-7e6f-8a9b-0c1dc7${suffix.padStart(6, '0')}`;

async function signUp(email: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/auth/sign-up')
    .send({ email, password: 'correct horse battery staple' });
  return response.body.accessToken as string;
}

describe('재고 등록', () => {
  it('등록하면 201과 계약 형태의 재고가 돌아온다', async () => {
    const token = await signUp('stock1@example.com');
    const skuId = sku('1');

    const response = await request(app.getHttpServer())
      .post('/stock')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId, onHand: 10 });

    expect(response.status).toBe(201);
    // 서버를 자기 계약에 묶는다.
    expect(() => stockContract.register.responses[201].parse(response.body)).not.toThrow();
    expect(response.body).toEqual({ skuId, onHand: 10, reserved: 0, available: 10 });
  });

  it('같은 SKU를 두 번 등록하면 409다', async () => {
    // 조용히 덮어쓰면 관리자가 등록을 두 번 눌렀을 때 기존 보유량이 사라진다.
    const token = await signUp('stock2@example.com');
    const skuId = sku('2');
    const send = () =>
      request(app.getHttpServer())
        .post('/stock')
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, onHand: 10 });

    expect((await send()).status).toBe(201);
    const second = await send();

    expect(second.status).toBe(409);
    expect(second.body.code).toBe(ErrorCode.DOMAIN_RULE_VIOLATED);
  });

  it('토큰 없이 등록하면 가드의 401이다', async () => {
    const response = await request(app.getHttpServer())
      .post('/stock')
      .send({ skuId: sku('3'), onHand: 1 });

    expect(response.status).toBe(401);
    // 메시지를 단언해 가드의 401과 다른 401(예: 토큰 만료 디코딩)을 구분한다.
    expect(response.body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('보유량이 비정수면 400 VALIDATION_FAILED다', async () => {
    const token = await signUp('stock4@example.com');
    const response = await request(app.getHttpServer())
      .post('/stock')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId: sku('4'), onHand: 1.5 });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe('재고 조회', () => {
  it('available은 onHand - reserved다', async () => {
    const token = await signUp('stock5@example.com');
    const skuId = sku('5');
    await request(app.getHttpServer())
      .post('/stock')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId, onHand: 7 });

    const response = await request(app.getHttpServer())
      .get(`/stock/${skuId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(() => stockContract.get.responses[200].parse(response.body)).not.toThrow();
    expect(response.body.available).toBe(response.body.onHand - response.body.reserved);
  });

  it('없는 SKU는 404 NOT_FOUND다', async () => {
    const token = await signUp('stock6@example.com');
    const response = await request(app.getHttpServer())
      .get(`/stock/${sku('99')}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('경로 파라미터가 uuid가 아니면 400이다', async () => {
    const token = await signUp('stock7@example.com');
    const response = await request(app.getHttpServer())
      .get('/stock/not-a-uuid')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });
});

describe('입고', () => {
  it('입고하면 204이고 보유량이 늘어 있다', async () => {
    const token = await signUp('stock8@example.com');
    const skuId = sku('8');
    await request(app.getHttpServer())
      .post('/stock')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId, onHand: 3 });

    const restock = await request(app.getHttpServer())
      .post(`/stock/${skuId}/restock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 5 });
    expect(restock.status).toBe(204);

    const after = await request(app.getHttpServer())
      .get(`/stock/${skuId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.body.onHand).toBe(8);
  });

  it('수량 0 입고는 400 VALIDATION_FAILED다', async () => {
    const token = await signUp('stock9@example.com');
    const skuId = sku('9');
    await request(app.getHttpServer())
      .post('/stock')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId, onHand: 3 });

    const response = await request(app.getHttpServer())
      .post(`/stock/${skuId}/restock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 0 });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('없는 SKU에 입고하면 404다', async () => {
    const token = await signUp('stock10@example.com');
    const response = await request(app.getHttpServer())
      .post(`/stock/${sku('98')}/restock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 5 });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe(ErrorCode.NOT_FOUND);
  });
});
