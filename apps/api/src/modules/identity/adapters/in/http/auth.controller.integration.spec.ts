import { ErrorCode } from '@commerce/contracts';
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
  // 이월 25: 복원하지 않으면 같은 워커의 이후 spec이 이 값을 상속한다.
  if (originalDatabaseUrl === undefined) {
    delete process.env['DATABASE_URL'];
  } else {
    process.env['DATABASE_URL'] = originalDatabaseUrl;
  }
});

const CREDENTIALS = { email: 'flow@example.com', password: 'correct horse battery staple' };

describe('인증 흐름', () => {
  it('가입 → 로그인 → 갱신 → 로그아웃이 이어진다', async () => {
    const signUp = await request(app.getHttpServer()).post('/auth/sign-up').send(CREDENTIALS);
    expect(signUp.status).toBe(201);
    expect(signUp.body.accessToken).toEqual(expect.any(String));

    const signIn = await request(app.getHttpServer()).post('/auth/sign-in').send(CREDENTIALS);
    expect(signIn.status).toBe(200);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: signIn.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(signIn.body.refreshToken);

    // 회전된 옛 토큰은 죽어 있다.
    const reused = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: signIn.body.refreshToken });
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe(ErrorCode.UNAUTHENTICATED);

    const signedOut = await request(app.getHttpServer())
      .post('/auth/sign-out')
      .send({ refreshToken: refreshed.body.refreshToken });
    expect(signedOut.status).toBe(204);

    const afterSignOut = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken });
    expect(afterSignOut.status).toBe(401);
  });

  it('중복 이메일 가입은 409 EMAIL_ALREADY_REGISTERED다', async () => {
    await request(app.getHttpServer()).post('/auth/sign-up').send(CREDENTIALS);
    const again = await request(app.getHttpServer()).post('/auth/sign-up').send(CREDENTIALS);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe(ErrorCode.EMAIL_ALREADY_REGISTERED);
  });

  it('잘못된 이메일 형식은 400 VALIDATION_FAILED다', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'nope', password: CREDENTIALS.password });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('짧은 비밀번호는 422 PASSWORD_POLICY_VIOLATED다', async () => {
    // Zod가 아니라 도메인이 잡는 것을 확인한다 (스펙 §8.4).
    const response = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'short@example.com', password: 'short' });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe(ErrorCode.PASSWORD_POLICY_VIOLATED);
  });

  it('틀린 비밀번호 로그인은 401 INVALID_CREDENTIALS다', async () => {
    await request(app.getHttpServer()).post('/auth/sign-up').send(CREDENTIALS);
    const response = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ ...CREDENTIALS, password: 'a different password' });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe(ErrorCode.INVALID_CREDENTIALS);
  });

  it('가입은 계정과 고객을 함께 만든다 — 곧바로 주소를 추가할 수 있다', async () => {
    // ACL이 실제로 연결됐는지 확인하는 유일한 테스트다. 두 모듈의 단위 테스트는
    // 각자의 대역 위에서 돌기 때문에 이 연결을 볼 수 없다.
    const signUp = await request(app.getHttpServer()).post('/auth/sign-up').send(CREDENTIALS);
    const response = await request(app.getHttpServer())
      .post('/addresses')
      .set('Authorization', `Bearer ${signUp.body.accessToken}`)
      .send({
        label: '집',
        recipient: '홍길동',
        phone: '010-1234-5678',
        zip: '06236',
        line1: '서울시 강남구 테헤란로 1',
      });
    expect(response.status).toBe(201);
    expect(response.body.isDefault).toBe(true);
  });

  it('비밀번호를 바꾸면 기존 세션이 전부 끊긴다', async () => {
    const signUp = await request(app.getHttpServer()).post('/auth/sign-up').send(CREDENTIALS);
    const changed = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${signUp.body.accessToken}`)
      .send({ currentPassword: CREDENTIALS.password, newPassword: 'a brand new password 99' });
    expect(changed.status).toBe(204);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: signUp.body.refreshToken });
    expect(refreshed.status).toBe(401);
  });
});
