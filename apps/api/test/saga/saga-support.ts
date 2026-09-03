import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import {
  EXPIRE_RESERVATIONS_USECASE,
  type ExpireReservationsUseCase,
} from '../../src/modules/inventory/application/ports/in/expire-reservations.usecase';
import {
  RESERVE_STOCK_USECASE,
  type ReserveStockUseCase,
} from '../../src/modules/inventory/application/ports/in/reserve-stock.usecase';
import { FakePgAdapter } from '../../src/modules/payment/adapters/out/pg/fake-pg.adapter';
import { OutboxRelay } from '../../src/shared/infrastructure/outbox/outbox-relay';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service';
import { workerDatabaseName } from '../setup/database';

interface MoneyDto {
  amount: string;
  currency: 'KRW' | 'USD';
}

/**
 * 사가 E2E 하니스.
 *
 * **모든 준비를 HTTP로 한다.** 원시 SQL로 데이터를 심으면 매퍼와 유스케이스를
 * 건너뛰고, 그러면 E2E가 "우리 API가 실제로 이 흐름을 지원하는가"를 검증하지 못한다.
 * 예외는 시간을 미는 것뿐이다 — 15분을 기다릴 수는 없다.
 */
export class SagaHarness {
  private constructor(
    private readonly app: INestApplication,
    private readonly originalDatabaseUrl: string | undefined,
  ) {}

  static async boot(): Promise<SagaHarness> {
    const original = process.env['DATABASE_URL'];
    process.env['DATABASE_URL'] =
      `${process.env['TEST_DATABASE_BASE_URL']}/${workerDatabaseName()}`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return new SagaHarness(app, original);
  }

  async close(): Promise<void> {
    await this.app.close();
    // process.env는 워커 단위라 복원하지 않으면 같은 워커의 이후 spec이 상속한다.
    if (this.originalDatabaseUrl === undefined) {
      delete process.env['DATABASE_URL'];
    } else {
      process.env['DATABASE_URL'] = this.originalDatabaseUrl;
    }
  }

  /** PG 시나리오를 바꾸는 통로. `useExisting`이라 실제 결제 경로와 같은 인스턴스다. */
  pg(): FakePgAdapter {
    return this.app.get(FakePgAdapter);
  }

  private get http() {
    return request(this.app.getHttpServer());
  }

  private auth(token: string): { Authorization: string } {
    return { Authorization: `Bearer ${token}` };
  }

  async signUp(email: string): Promise<{ token: string; customerId: string }> {
    const response = await this.http
      .post('/auth/sign-up')
      .send({ email, password: 'correct horse battery staple' });
    expectStatus(response, 201, 'sign-up');
    return { token: response.body.accessToken as string, customerId: '' };
  }

  async registerProduct(
    token: string,
    body: { name: string; skus: Array<{ code: string; price: MoneyDto }> },
  ): Promise<{ productId: string; skuIds: string[] }> {
    const response = await this.http.post('/products').set(this.auth(token)).send(body);
    expectStatus(response, 201, 'register-product');
    return {
      productId: response.body.id as string,
      skuIds: (response.body.skus as Array<{ id: string }>).map((sku) => sku.id),
    };
  }

  async changePrice(
    token: string,
    productId: string,
    skuId: string,
    price: MoneyDto,
  ): Promise<void> {
    const response = await this.http
      .put(`/products/${productId}/skus/${skuId}/price`)
      .set(this.auth(token))
      .send({ price });
    expectStatus(response, 204, 'change-price');
  }

  async registerStock(token: string, skuId: string, onHand: number): Promise<void> {
    const response = await this.http.post('/stock').set(this.auth(token)).send({ skuId, onHand });
    expectStatus(response, 201, 'register-stock');
  }

  async addAddress(token: string): Promise<string> {
    const response = await this.http.post('/addresses').set(this.auth(token)).send({
      label: '집',
      recipient: '홍길동',
      phone: '010-1234-5678',
      zip: '06236',
      line1: '서울시 강남구 테헤란로 1',
    });
    expectStatus(response, 201, 'add-address');
    return response.body.id as string;
  }

  async addToCart(token: string, skuId: string, quantity: number): Promise<void> {
    const response = await this.http
      .post('/cart/items')
      .set(this.auth(token))
      .send({ skuId, quantity });
    expectStatus(response, 204, 'add-to-cart');
  }

  async cartOf(token: string): Promise<{ lines: unknown[]; total: MoneyDto }> {
    const response = await this.http.get('/cart').set(this.auth(token));
    expectStatus(response, 200, 'get-cart');
    return response.body;
  }

  async placeOrder(token: string, addressId: string): Promise<{ orderId: string; status: string }> {
    const response = await this.http.post('/orders').set(this.auth(token)).send({ addressId });
    expectStatus(response, 201, 'place-order');
    return response.body;
  }

  /** 실패를 기대하는 경로에서 쓴다. 상태 코드와 본문을 그대로 돌려준다. */
  async tryPlaceOrder(
    token: string,
    addressId: string,
  ): Promise<{ status: number; body: { code?: string } }> {
    const response = await this.http.post('/orders').set(this.auth(token)).send({ addressId });
    return { status: response.status, body: response.body };
  }

  async cancelOrder(token: string, orderId: string): Promise<{ status: string }> {
    const response = await this.http.post(`/orders/${orderId}/cancel`).set(this.auth(token));
    expectStatus(response, 200, 'cancel-order');
    return response.body;
  }

  async orderOf(token: string, orderId: string): Promise<Record<string, never> & OrderShape> {
    const response = await this.http.get(`/orders/${orderId}`).set(this.auth(token));
    expectStatus(response, 200, 'get-order');
    return response.body;
  }

  async listOrders(token: string): Promise<Array<{ id: string; status: string }>> {
    const response = await this.http.get('/orders').set(this.auth(token));
    expectStatus(response, 200, 'list-orders');
    return response.body.orders;
  }

  async stockOf(
    token: string,
    skuId: string,
  ): Promise<{ skuId: string; onHand: number; reserved: number; available: number }> {
    const response = await this.http.get(`/stock/${skuId}`).set(this.auth(token));
    expectStatus(response, 200, 'get-stock');
    return response.body;
  }

  /**
   * outbox를 비운다. 구독자가 새 이벤트를 낳으므로(OrderCancelled → PaymentRefunded → …)
   * 더 이상 보낼 것이 없을 때까지 반복한다.
   *
   * 스케줄러는 테스트에서 꺼져 있다(계획 3의 `SCHEDULERS_ENABLED=false`). 이벤트를
   * 흘리려면 릴레이를 **명시적으로** 돌려야 하고, 그것이 테스트를 결정론적으로 만든다 —
   * 5초 주기를 기다리는 테스트는 느리고 불안정하다.
   *
   * 상한이 있는 이유: 구독자가 자기가 소비한 이벤트를 다시 발행하는 버그가 있으면
   * 이 루프가 영원히 돈다. 상한에 걸리면 그 자체가 발견이다.
   */
  async drainOutbox(maxRounds = 10): Promise<number> {
    const relay = this.app.get(OutboxRelay);
    let total = 0;
    for (let round = 0; round < maxRounds; round += 1) {
      const sent = await relay.relayOnce();
      total += sent;
      if (sent === 0) {
        return total;
      }
    }
    throw new Error(`outbox가 ${maxRounds}회 안에 비워지지 않았습니다 (총 ${total}건 발행).`);
  }

  /**
   * 이미 발행된 이벤트를 미발행으로 되돌린다. 릴레이 인스턴스가 둘일 때 같은 행을
   * 둘 다 집는 상황과 같다 — 편차 5가 감수하기로 한 바로 그 시나리오다.
   */
  async resetPublished(eventType: string): Promise<void> {
    await this.app.get(PrismaService).outbox.updateMany({
      where: { eventType },
      data: { publishedAt: null, attempts: 0, nextAttemptAt: null },
    });
  }

  /**
   * 예약의 `expires_at`을 과거로 민다. `Clock`을 조작하는 대신 데이터를 미는 이유:
   * 앱이 `SystemClock`으로 배선돼 있고, E2E는 배선을 바꾸지 않는 것이 목적이다.
   * 이 스위트가 검증하는 것은 시간 계산이 아니라 **이벤트 체인**이다.
   */
  async expireReservations(orderId: string): Promise<void> {
    await this.app.get(PrismaService).reservation.updateMany({
      where: { orderId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
  }

  /**
   * 예약만 직접 잡는다 — **"보상이 돌기 전에 프로세스가 죽었다"를 재현하는 도구다.**
   *
   * HTTP 경로로는 이 상태를 만들 수 없다: `PlaceOrderService`가 PG 실패 시 예약을
   * 반드시 풀기 때문이다. TTL 자가치유(스펙 §6.2의 5단계)는 바로 그 보상이 돌지
   * 못한 경우를 위한 그물이고, 그 상황을 만들려면 사가를 중간에 끊어야 한다.
   *
   * 원시 SQL이 아니라 유스케이스를 쓴다 — 매퍼와 재고 카운터를 함께 지나가야
   * 만료 스캔이 실제 데이터를 보게 된다.
   */
  async reserveDirectly(orderId: string, skuId: string, quantity: number): Promise<string> {
    const result = await this.app
      .get<ReserveStockUseCase>(RESERVE_STOCK_USECASE)
      .execute({ orderId, skuId, quantity });
    return result.reservationId;
  }

  /**
   * 전송에 실패해 재시도 대기 중인 outbox 행 수.
   *
   * `drainOutbox`는 실패를 조용히 넘긴다 — `OutboxRelay`가 전송 실패를 `attempts`
   * 증가 + 백오프로 다루기 때문이다(계획 1의 poison-tolerance). 그래서 구독자가
   * 던져도 E2E는 아무것도 눈치채지 못한다. 이 값을 단언해야 그 침묵이 깨진다.
   */
  async failedOutboxCount(): Promise<number> {
    return this.app.get(PrismaService).outbox.count({ where: { attempts: { gt: 0 } } });
  }

  /** 만료 스캔을 한 번 돌린다. 스케줄러는 테스트에서 꺼져 있다(계획 3). */
  async runExpiryScan(): Promise<number> {
    return this.app.get<ExpireReservationsUseCase>(EXPIRE_RESERVATIONS_USECASE).execute();
  }
}

interface OrderShape {
  id: string;
  status: string;
  total: MoneyDto;
  shippingAddress: { recipient: string };
  lines: Array<{ skuId: string; nameSnapshot: string; unitPrice: MoneyDto; quantity: number }>;
}

/** 준비 단계가 조용히 실패하면 그 뒤 단언이 엉뚱한 이유로 깨진다. */
function expectStatus(
  response: { status: number; body: unknown },
  expected: number,
  step: string,
): void {
  if (response.status !== expected) {
    throw new Error(
      `${step}: ${expected}를 기대했는데 ${response.status}였다 — ${JSON.stringify(response.body)}`,
    );
  }
}
