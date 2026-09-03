import { describe, expect, it } from 'vitest';
import { Duration } from '../../../shared/kernel/duration';
import { OrderId, ReservationId, SkuId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import { Quantity } from '../../../shared/kernel/quantity';
import type { ReservationRepository } from '../application/ports/out/reservation.repository';
import { Reservation, type ReservationStatus } from '../domain/reservation';
import { FIXED_NOW, orderUuid, reservationUuid, skuUuid } from './inventory.fixtures';

const TTL = Duration.minutes(15);

function aReservation(
  suffix: string,
  options: { status?: ReservationStatus; ttlMinutes?: number; quantity?: number } = {},
): Reservation {
  const ttl = Duration.minutes(options.ttlMinutes ?? 15);
  const base = Reservation.create({
    id: ReservationId.of(reservationUuid(suffix)),
    skuId: SkuId.of(skuUuid(suffix)),
    orderId: OrderId.of(orderUuid(suffix)),
    quantity: Quantity.of(options.quantity ?? 3),
    now: FIXED_NOW,
    ttl,
  });
  base.pullEvents();
  if (options.status === undefined || options.status === 'PENDING') return base;
  return Reservation.rehydrate({
    id: base.id,
    skuId: base.skuId,
    orderId: base.orderId,
    quantity: base.quantity,
    status: options.status,
    expiresAt: base.expiresAt,
    createdAt: base.createdAt,
  });
}

export function reservationRepositoryContract(
  name: string,
  createRepo: () => Promise<ReservationRepository>,
  runInTransaction?: <T>(work: (tx: TransactionContext) => Promise<T>) => Promise<T>,
): void {
  describe(`ReservationRepository 계약 — ${name}`, () => {
    it('저장한 예약을 ID로 찾는다', async () => {
      const repo = await createRepo();
      const reservation = aReservation('1');
      await repo.save(reservation);
      expect((await repo.findById(reservation.id))?.orderId).toBe(reservation.orderId);
    });

    it('없는 ID는 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findById(ReservationId.of(reservationUuid('9999')))).toBeNull();
    });

    it('상태·수량·시각이 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      const reservation = aReservation('2', { status: 'CONFIRMED', quantity: 7 });
      await repo.save(reservation);

      const found = await repo.findById(reservation.id);
      expect(found?.status).toBe('CONFIRMED');
      expect(found?.quantity.value).toBe(7);
      expect(found?.expiresAt).toEqual(new Date(FIXED_NOW.getTime() + TTL.millis));
      expect(found?.createdAt).toEqual(FIXED_NOW);
      expect(found?.skuId).toBe(reservation.skuId);
    });

    it('확정한 예약을 다시 저장하면 갱신된다 — 행이 늘지 않는다', async () => {
      const repo = await createRepo();
      const reservation = aReservation('3');
      await repo.save(reservation);

      const loaded = await repo.findById(reservation.id);
      loaded?.confirm(FIXED_NOW);
      if (loaded) await repo.save(loaded);

      expect((await repo.findById(reservation.id))?.status).toBe('CONFIRMED');
    });

    it('복원된 예약은 미커밋 이벤트를 갖지 않는다', async () => {
      // 갖는다면 조회할 때마다 만료 이벤트가 outbox에 다시 들어간다.
      const repo = await createRepo();
      const reservation = aReservation('4');
      await repo.save(reservation);
      expect((await repo.findById(reservation.id))?.hasUncommittedEvents).toBe(false);
    });

    it('findExpired가 PENDING이면서 만료된 것만 돌려준다', async () => {
      // 이미 확정된 예약을 TTL이 만료시키면 재고를 두 번 돌려주게 된다 —
      // 초과 판매의 직행 경로다.
      const repo = await createRepo();
      await repo.save(aReservation('10', { ttlMinutes: 5 }));
      await repo.save(aReservation('11', { ttlMinutes: 5, status: 'CONFIRMED' }));
      await repo.save(aReservation('12', { ttlMinutes: 5, status: 'RELEASED' }));
      await repo.save(aReservation('13', { ttlMinutes: 5, status: 'EXPIRED' }));

      const after = new Date(FIXED_NOW.getTime() + Duration.minutes(6).millis);
      const expired = await repo.findExpired(after, 100);
      expect(expired.map((r) => r.id)).toEqual([ReservationId.of(reservationUuid('10'))]);
    });

    it('findExpired가 아직 만료되지 않은 예약을 제외한다', async () => {
      const repo = await createRepo();
      await repo.save(aReservation('20', { ttlMinutes: 60 }));
      const after = new Date(FIXED_NOW.getTime() + Duration.minutes(6).millis);
      expect(await repo.findExpired(after, 100)).toEqual([]);
    });

    it('findExpired가 expires_at 오름차순으로 돌려준다', async () => {
      // 오래된 것부터 처리해야 밀린 큐가 줄어든다.
      const repo = await createRepo();
      await repo.save(aReservation('31', { ttlMinutes: 3 }));
      await repo.save(aReservation('30', { ttlMinutes: 1 }));
      await repo.save(aReservation('32', { ttlMinutes: 2 }));

      const after = new Date(FIXED_NOW.getTime() + Duration.minutes(10).millis);
      const expired = await repo.findExpired(after, 100);
      expect(expired.map((r) => r.id)).toEqual([
        ReservationId.of(reservationUuid('30')),
        ReservationId.of(reservationUuid('32')),
        ReservationId.of(reservationUuid('31')),
      ]);
    });

    it('findExpired의 limit이 동작한다', async () => {
      // 장애 후 만료가 수만 건 밀려 있을 때 한 번에 다 처리하려 들면
      // 그 실행이 끝나지 않고 다음 주기가 겹쳐 들어온다.
      const repo = await createRepo();
      await repo.save(aReservation('40', { ttlMinutes: 1 }));
      await repo.save(aReservation('41', { ttlMinutes: 2 }));

      const after = new Date(FIXED_NOW.getTime() + Duration.minutes(10).millis);
      expect(await repo.findExpired(after, 1)).toHaveLength(1);
    });

    it.skipIf(runInTransaction === undefined)(
      '트랜잭션이 롤백되면 저장한 예약이 남지 않는다',
      async () => {
        const runner = runInTransaction;
        if (!runner) return;
        const repo = await createRepo();
        const reservation = aReservation('50');

        await expect(
          runner(async (tx) => {
            await repo.save(reservation, tx);
            throw new Error('의도적 롤백');
          }),
        ).rejects.toThrow('의도적 롤백');

        expect(await repo.findById(reservation.id)).toBeNull();
      },
    );
  });
}
