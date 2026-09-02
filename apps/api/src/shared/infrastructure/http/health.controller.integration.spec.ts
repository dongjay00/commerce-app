import { healthContract } from '@commerce/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, workerDatabaseName } from '../../../../test/setup/database';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

let app: INestApplication;

beforeAll(async () => {
  // PrismaService는 생성 시점에 process.env['DATABASE_URL']을 읽는다.
  // 이 워커 전용 테스트 DB(testDb()가 없으면 만든다)를 가리키도록 맞춘 뒤 컨트롤러를 조립한다.
  await testDb();
  const baseUrl = process.env['TEST_DATABASE_BASE_URL'];
  process.env['DATABASE_URL'] = `${baseUrl}/${workerDatabaseName()}`;

  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [PrismaService],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('실제 서버 응답이 계약 스키마를 통과한다 — 목이 아니라 서버 자신이 계약에 묶인다', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(() => healthContract.check.responses[200].parse(response.body)).not.toThrow();
  });

  it('데이터베이스가 연결되어 있으면 up을 반환한다', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'up' });
  });
});
