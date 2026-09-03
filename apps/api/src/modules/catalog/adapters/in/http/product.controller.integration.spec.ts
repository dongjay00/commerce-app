import { ErrorCode, productContract } from '@commerce/contracts';
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

const PRICE = { amount: '1000', currency: 'KRW' as const };
const BODY = {
  name: '티셔츠',
  skus: [
    { code: 'RED-M', price: PRICE },
    { code: 'RED-L', price: { amount: '1200', currency: 'KRW' as const } },
  ],
};

async function signUp(email: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/auth/sign-up')
    .send({ email, password: 'correct horse battery staple' });
  return response.body.accessToken as string;
}

describe('상품 등록', () => {
  it('등록하면 201과 계약 형태의 상품이 돌아온다', async () => {
    const token = await signUp('catalog1@example.com');
    const response = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send(BODY);

    expect(response.status).toBe(201);
    // 서버를 자기 계약에 묶는다. 함수 반환값은 excess property 검사가 걸리지 않아
    // 필드가 새어도 타입 검사가 통과한다 — 계획 2의 최종 리뷰가 잡은 항목이다.
    expect(() => productContract.register.responses[201].parse(response.body)).not.toThrow();
    expect(response.body.skus).toHaveLength(2);
    expect(response.body.status).toBe('ACTIVE');
  });

  it('토큰 없이 등록하면 401이고 가드가 낸 것이다', async () => {
    const response = await request(app.getHttpServer()).post('/products').send(BODY);
    expect(response.status).toBe(401);
    // 메시지로 가드의 401과 @CurrentPrincipal()의 401을 구분한다.
    expect(response.body.message).toBe('인증 토큰이 없습니다.');
  });

  it('SKU 코드가 중복이면 409 DOMAIN_RULE_VIOLATED다', async () => {
    const token = await signUp('catalog2@example.com');
    const response = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '티셔츠',
        skus: [
          { code: 'SAME', price: PRICE },
          { code: 'SAME', price: PRICE },
        ],
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(ErrorCode.DOMAIN_RULE_VIOLATED);
  });

  it('0원 가격이면 400 VALIDATION_FAILED다', async () => {
    const token = await signUp('catalog3@example.com');
    const response = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '티셔츠', skus: [{ code: 'FREE', price: { amount: '0', currency: 'KRW' } }] });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe('가격 변경', () => {
  it('변경하면 204이고 다시 조회하면 바뀌어 있다', async () => {
    const token = await signUp('catalog4@example.com');
    const created = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send(BODY);
    const { id: productId, skus } = created.body;

    const changed = await request(app.getHttpServer())
      .put(`/products/${productId}/skus/${skus[0].id}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: { amount: '1800', currency: 'KRW' } });
    expect(changed.status).toBe(204);

    const fetched = await request(app.getHttpServer()).get(`/products/${productId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.skus.find((s: { id: string }) => s.id === skus[0].id).price.amount).toBe(
      '1800',
    );
  });

  it('다른 상품의 SKU ID로 변경하면 404다', async () => {
    // 403이 아니라 404다 — "그 ID는 존재하지만 이 상품 것이 아니다"를 흘리지 않는다.
    const token = await signUp('catalog5@example.com');
    const a = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send(BODY);
    const b = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '바지', skus: [{ code: 'BLUE-M', price: PRICE }] });

    const response = await request(app.getHttpServer())
      .put(`/products/${a.body.id}/skus/${b.body.skus[0].id}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: { amount: '1800', currency: 'KRW' } });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('경로 파라미터가 uuid가 아니면 400이다', async () => {
    const token = await signUp('catalog6@example.com');
    const response = await request(app.getHttpServer())
      .put('/products/not-a-uuid/skus/also-not-a-uuid/price')
      .set('Authorization', `Bearer ${token}`)
      .send({ price: { amount: '1800', currency: 'KRW' } });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe('조회와 검색', () => {
  it('검색 응답이 계약 형태다', async () => {
    const token = await signUp('catalog7@example.com');
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send(BODY);

    const response = await request(app.getHttpServer()).get('/products');
    expect(response.status).toBe(200);
    expect(() => productContract.search.responses[200].parse(response.body)).not.toThrow();
    expect(response.body.products).toHaveLength(1);
  });

  it('없는 상품 조회는 404다', async () => {
    const response = await request(app.getHttpServer()).get(
      '/products/018f2b1c-4a5d-7e6f-8a9b-0c1da0999999',
    );
    expect(response.status).toBe(404);
  });

  it('limit 상한을 넘으면 400이다', async () => {
    const response = await request(app.getHttpServer()).get('/products?limit=1000');
    expect(response.status).toBe(400);
  });
});
