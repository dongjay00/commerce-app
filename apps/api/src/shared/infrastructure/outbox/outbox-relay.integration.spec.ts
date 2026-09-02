import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../test/setup/database';
import { Duration } from '../../kernel/duration';
import { MutableClock } from '../../testing/mutable-clock';
import { RecordingEventTransport } from '../../testing/recording-event-transport';
import { OutboxRelay } from './outbox-relay';

let db: PrismaClient;
let transport: RecordingEventTransport;
let clock: MutableClock;
let relay: OutboxRelay;

const NOW = new Date('2026-02-01T00:00:00.000Z');

beforeAll(async () => {
  db = await testDb();
});

beforeEach(() => {
  transport = new RecordingEventTransport();
  clock = new MutableClock(NOW);
  relay = new OutboxRelay(db, transport, clock);
});

let rowCounter = 0;

async function seedEvent(eventType: string, occurredAt: string): Promise<string> {
  rowCounter += 1;
  const id = `0192f3a0-8888-7abc-8def-${rowCounter.toString(16).padStart(12, '0')}`;
  await db.outbox.create({
    data: {
      id,
      aggregateType: 'Order',
      aggregateId: '0192f3a0-1234-7abc-8def-0123456789ab',
      eventType,
      payload: { note: eventType },
      occurredAt: new Date(occurredAt),
    },
  });
  return id;
}

describe('OutboxRelay', () => {
  it('발행할 이벤트가 없으면 0을 반환한다', async () => {
    await expect(relay.relayOnce()).resolves.toBe(0);
    expect(transport.sent).toEqual([]);
  });

  it('미발행 이벤트를 전송한다', async () => {
    await seedEvent('OrderPaid', '2026-01-01T00:00:00Z');

    await expect(relay.relayOnce()).resolves.toBe(1);
    expect(transport.sent.map((r) => r.eventType)).toEqual(['OrderPaid']);
    expect(transport.sent[0]?.payload).toEqual({ note: 'OrderPaid' });
  });

  it('전송에 성공하면 published_at을 현재 시각으로 채운다', async () => {
    await seedEvent('OrderPaid', '2026-01-01T00:00:00Z');
    await relay.relayOnce();

    const [row] = await db.outbox.findMany();
    expect(row?.publishedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('이미 발행된 이벤트는 다시 보내지 않는다 — 멱등성', async () => {
    await seedEvent('OrderPaid', '2026-01-01T00:00:00Z');

    await relay.relayOnce();
    await expect(relay.relayOnce()).resolves.toBe(0);
    expect(transport.sent).toHaveLength(1);
  });

  it('occurred_at 오름차순으로 전송한다', async () => {
    await seedEvent('Third', '2026-01-03T00:00:00Z');
    await seedEvent('First', '2026-01-01T00:00:00Z');
    await seedEvent('Second', '2026-01-02T00:00:00Z');

    await relay.relayOnce();
    expect(transport.sent.map((r) => r.eventType)).toEqual(['First', 'Second', 'Third']);
  });

  it('배치 크기를 넘겨 보내지 않는다', async () => {
    await seedEvent('A', '2026-01-01T00:00:00Z');
    await seedEvent('B', '2026-01-02T00:00:00Z');
    await seedEvent('C', '2026-01-03T00:00:00Z');

    const limited = new OutboxRelay(db, transport, clock, 2);
    await expect(limited.relayOnce()).resolves.toBe(2);
    await expect(db.outbox.count({ where: { publishedAt: null } })).resolves.toBe(1);
  });

  it('전송이 실패한 이벤트는 미발행으로 남아 백오프가 지난 다음 라운드에 재시도된다', async () => {
    await seedEvent('Flaky', '2026-01-01T00:00:00Z');
    transport.failWhen((record) => record.eventType === 'Flaky');

    // relayOnce는 더 이상 던지지 않는다 — 실패는 행 단위로 삼켜지고 배치는 계속된다.
    await expect(relay.relayOnce()).resolves.toBe(0);
    await expect(db.outbox.count({ where: { publishedAt: null } })).resolves.toBe(1);

    // 백오프가 지나기 전에는 다시 선택되지 않는다.
    transport.succeedAlways();
    await expect(relay.relayOnce()).resolves.toBe(0);
    expect(transport.sent).toEqual([]);

    // attempts=1이라 백오프는 2초. 그 시각을 지나야 재선택된다.
    clock.advanceBy(Duration.seconds(2));
    await expect(relay.relayOnce()).resolves.toBe(1);
    await expect(db.outbox.count({ where: { publishedAt: null } })).resolves.toBe(0);
  });

  it('배치 중간에 실패해도 이미 보낸 이벤트는 발행 완료로 남는다', async () => {
    await seedEvent('Good', '2026-01-01T00:00:00Z');
    await seedEvent('Bad', '2026-01-02T00:00:00Z');
    transport.failWhen((record) => record.eventType === 'Bad');

    await expect(relay.relayOnce()).resolves.toBe(1);

    const good = await db.outbox.findFirst({ where: { eventType: 'Good' } });
    const bad = await db.outbox.findFirst({ where: { eventType: 'Bad' } });
    expect(good?.publishedAt).not.toBeNull();
    expect(bad?.publishedAt).toBeNull();
  });

  it('영구히 실패하는 이벤트가 있어도 뒤따르는 이벤트는 배달된다 — 독이 든 이벤트가 나머지를 막지 않는다', async () => {
    await seedEvent('Poison', '2026-01-01T00:00:00Z');
    await seedEvent('Healthy', '2026-01-02T00:00:00Z');
    transport.failWhen((record) => record.eventType === 'Poison');

    await expect(relay.relayOnce()).resolves.toBe(1);
    expect(transport.sent.map((r) => r.eventType)).toEqual(['Healthy']);

    const poison = await db.outbox.findFirst({ where: { eventType: 'Poison' } });
    const healthy = await db.outbox.findFirst({ where: { eventType: 'Healthy' } });
    expect(poison?.publishedAt).toBeNull();
    expect(healthy?.publishedAt).not.toBeNull();

    // 두 번째 폴링에서는 Poison의 백오프(attempts=1 → 2초)가 지나도록 시계를
    // 돌려, Poison이 실제로 다시 선택되게 만든다. 시계를 그대로 두면 Poison은
    // nextAttemptAt 조건에 걸려 이번 배치에서 아예 빠지므로 — 그 상태에서
    // Third만 배달돼도 "재선택된 Poison이 배치를 막지 않는다"는 증명은 안
    // 되고, 이미 :94-111에서 검증한 "백오프 중인 행은 재선택되지 않는다"만
    // 반복하는 셈이다. 여기서는 Poison이 같은 배치에서 다시 실패하는 동안
    // Third가 배달되는지를 본다.
    await seedEvent('Third', '2026-01-03T00:00:00Z');
    clock.advanceBy(Duration.seconds(2));
    await expect(relay.relayOnce()).resolves.toBe(1);
    expect(transport.sent.map((r) => r.eventType)).toEqual(['Healthy', 'Third']);

    // attempts===2가 핵심이다: Poison이 필터링되어 조용히 빠진 게 아니라
    // 배치에 실제로 들어와 다시 실패했다는 증거다.
    const poisonAfter = await db.outbox.findFirst({ where: { eventType: 'Poison' } });
    expect(poisonAfter?.attempts).toBe(2);
    expect(poisonAfter?.publishedAt).toBeNull();
    const third = await db.outbox.findFirst({ where: { eventType: 'Third' } });
    expect(third?.publishedAt).not.toBeNull();
  });

  it('전송 실패 시 attempts를 늘리고 last_error를 남긴다', async () => {
    const id = await seedEvent('Flaky', '2026-01-01T00:00:00Z');
    transport.failWhen((record) => record.eventType === 'Flaky');

    await relay.relayOnce();

    const row = await db.outbox.findUniqueOrThrow({ where: { id } });
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('전송 실패: Flaky');
    expect(row.publishedAt).toBeNull();
  });

  it('연속 실패마다 attempts가 누적되고 백오프가 매번 뒤로 밀린다', async () => {
    const id = await seedEvent('Flaky', '2026-01-01T00:00:00Z');
    transport.failWhen((record) => record.eventType === 'Flaky');

    await relay.relayOnce(); // attempts=1, 백오프 2초
    clock.advanceBy(Duration.seconds(2));
    await relay.relayOnce(); // attempts=2, 백오프 4초
    clock.advanceBy(Duration.seconds(4));
    await relay.relayOnce(); // attempts=3, 백오프 8초

    const row = await db.outbox.findUniqueOrThrow({ where: { id } });
    expect(row.attempts).toBe(3);
    expect(row.publishedAt).toBeNull();
  });

  it('재시도 한도(MAX_ATTEMPTS)를 넘긴 행은 데드레터 상태로 더 이상 선택되지 않는다', async () => {
    const id = await seedEvent('Doomed', '2026-01-01T00:00:00Z');
    // 직접 attempts를 한도(10)까지 올려, 백오프 산수에 결합되지 않고 한도 자체를 검증한다.
    await db.outbox.update({
      where: { id },
      data: { attempts: 10, lastError: '이전 실패 10회' },
    });

    // 시간을 아무리 지나도 (nextAttemptAt이 없으니) 재선택되지 않아야 한다.
    clock.advanceBy(Duration.hours(1));
    await expect(relay.relayOnce()).resolves.toBe(0);
    expect(transport.sent).toEqual([]);

    const row = await db.outbox.findUniqueOrThrow({ where: { id } });
    expect(row.publishedAt).toBeNull();
    expect(row.lastError).toBe('이전 실패 10회');
  });

  it('발행 마킹 update가 실패하면 전송 실패로 오기록하지 않고 배치를 중단한다', async () => {
    const first = await seedEvent('First', '2026-01-01T00:00:00Z');
    await seedEvent('Second', '2026-01-02T00:00:00Z');

    // 모킹 라이브러리 없이, Clock.now() 호출 두 번째 것만 던지게 만든다.
    // relayOnce의 호출 순서는 고정적이다: ①배치 조회 시각(맨 위) ②First
    // 발행 마킹 update가 읽는 시각. 이 두 번째 호출에서만 실패시켜 "send는
    // 성공했지만 그 직후 DB에 publishedAt을 쓰지 못한다"를 재현한다.
    // (재시도 기록 update가 읽는 nextAttemptAt 계산도 clock.now()를 쓰지만,
    // 그건 이 시나리오에서 세 번째 호출이라 영향받지 않는다 — 그 update가
    // 실제로 실행되어야 "현재 구현이 두 update를 구분하는지"가 드러난다.)
    let calls = 0;
    const flakyClock = {
      now: (): Date => {
        calls += 1;
        if (calls === 2) {
          throw new Error('시각 조회 실패');
        }
        return clock.now();
      },
    };
    relay = new OutboxRelay(db, transport, flakyClock);

    await expect(relay.relayOnce()).rejects.toThrow('시각 조회 실패');

    const firstRow = await db.outbox.findUniqueOrThrow({ where: { id: first } });
    expect(firstRow.attempts).toBe(0); // transport를 탓하지 않았다
    expect(firstRow.lastError).toBeNull(); // last_error에 이 실패가 새어 나가지 않았다
    expect(firstRow.publishedAt).toBeNull();
    expect(transport.sent.map((r) => r.eventType)).toEqual(['First']);

    // Second는 손대지 않았다 — 배치가 중단됐다는 증거.
    const second = await db.outbox.findFirstOrThrow({ where: { eventType: 'Second' } });
    expect(second.attempts).toBe(0);
    expect(second.publishedAt).toBeNull();
  });

  it('데드레터로 전이하는 실패는 로그를 남기지만, 그 전 재시도들은 남기지 않는다', async () => {
    const id = await seedEvent('Doomed', '2026-01-01T00:00:00Z');
    // attempts를 한도 직전(9)까지 올려, 다음 실패 한 번으로 데드레터 전이를 만든다.
    await db.outbox.update({ where: { id }, data: { attempts: 9 } });
    transport.failWhen((record) => record.eventType === 'Doomed');

    // 모킹 라이브러리 없이, Logger.prototype.error를 직접 갈아 끼워 호출을 기록한다.
    const calls: unknown[] = [];
    const originalError = Logger.prototype.error;
    Logger.prototype.error = ((message?: unknown) => {
      calls.push(message);
    }) as typeof Logger.prototype.error;

    try {
      await relay.relayOnce();
      expect(calls).toHaveLength(1);
      expect(String(calls[0])).toContain(id);
      expect(String(calls[0])).toContain('Doomed');

      calls.length = 0;
      // 아직 한도 미만인 일반 실패는 조용해야 한다 — 매 실패마다 로그를 남기면
      // 신호가 잡음에 묻힌다.
      await seedEvent('Flaky', '2026-01-02T00:00:00Z');
      transport.failWhen((record) => record.eventType === 'Flaky');
      await relay.relayOnce();
      expect(calls).toHaveLength(0);
    } finally {
      Logger.prototype.error = originalError;
    }
  });
});
