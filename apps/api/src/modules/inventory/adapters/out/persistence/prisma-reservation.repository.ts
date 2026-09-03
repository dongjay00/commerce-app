import type { PrismaClient } from '@prisma/client';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { OrderId, ReservationId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { ReservationRepository } from '../../../application/ports/out/reservation.repository';
import type { Reservation } from '../../../domain/reservation';
import { toReservationDomain, toReservationRow } from './reservation.mapper';

export class PrismaReservationRepository implements ReservationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: ReservationId, tx?: TransactionContext): Promise<Reservation | null> {
    const row = await this.client(tx).reservation.findUnique({ where: { id } });
    return row === null ? null : toReservationDomain(row);
  }

  async findByOrderId(orderId: OrderId, tx?: TransactionContext): Promise<Reservation[]> {
    const rows = await this.client(tx).reservation.findMany({
      where: { orderId },
      // 순서를 고정한다 — 정렬을 명시하지 않은 SQL의 순서는 계약이 아니다.
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toReservationDomain);
  }

  async save(reservation: Reservation, tx?: TransactionContext): Promise<void> {
    const row = toReservationRow(reservation);
    await this.client(tx).reservation.upsert({
      where: { id: row.id },
      create: row,
      update: { status: row.status, expiresAt: row.expiresAt, quantity: row.quantity },
    });
  }

  /**
   * **이 쿼리는 `apps/api/test/schema/indexes.integration.spec.ts`의 EXPLAIN 프루브와
   * 같은 모양이어야 한다.** 프루브가 다른 쿼리를 검사하면 "만료 스캔이 인덱스를 탄다"는
   * 주장이 실제 핫 경로에 대한 증거가 아니게 된다 — 계획 2에서 릴레이 쿼리로 같은
   * 지적을 받았다.
   *
   * `status = 'PENDING' AND expires_at <= now ORDER BY expires_at ASC LIMIT n`
   */
  async findExpired(now: Date, limit: number, tx?: TransactionContext): Promise<Reservation[]> {
    const rows = await this.client(tx).reservation.findMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      orderBy: { expiresAt: 'asc' }, // 오래된 것부터 — 밀린 큐가 줄어드는 방향
      take: limit,
    });
    return rows.map(toReservationDomain);
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
