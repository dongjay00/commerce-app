import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../test/setup/database';
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

  it('전송이 실패한 이벤트는 미발행으로 남아 다음 라운드에 재시도된다', async () => {
    await seedEvent('Flaky', '2026-01-01T00:00:00Z');
    transport.failWhen((record) => record.eventType === 'Flaky');

    await expect(relay.relayOnce()).rejects.toThrow('전송 실패: Flaky');
    await expect(db.outbox.count({ where: { publishedAt: null } })).resolves.toBe(1);

    transport.succeedAlways();
    await expect(relay.relayOnce()).resolves.toBe(1);
    await expect(db.outbox.count({ where: { publishedAt: null } })).resolves.toBe(0);
  });

  it('배치 중간에 실패해도 이미 보낸 이벤트는 발행 완료로 남는다', async () => {
    await seedEvent('Good', '2026-01-01T00:00:00Z');
    await seedEvent('Bad', '2026-01-02T00:00:00Z');
    transport.failWhen((record) => record.eventType === 'Bad');

    await expect(relay.relayOnce()).rejects.toThrow('전송 실패: Bad');

    const good = await db.outbox.findFirst({ where: { eventType: 'Good' } });
    const bad = await db.outbox.findFirst({ where: { eventType: 'Bad' } });
    expect(good?.publishedAt).not.toBeNull();
    expect(bad?.publishedAt).toBeNull();
  });
});
