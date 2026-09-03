import type { ReservationId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import { Quantity } from '../../../shared/kernel/quantity';
import type { ReservationRepository } from '../application/ports/out/reservation.repository';
import { Reservation } from '../domain/reservation';

export class InMemoryReservationRepository implements ReservationRepository {
  private readonly byId = new Map<string, Reservation>();

  async findById(id: ReservationId, _tx?: TransactionContext): Promise<Reservation | null> {
    const stored = this.byId.get(id);
    return stored ? InMemoryReservationRepository.copy(stored) : null;
  }

  async save(reservation: Reservation, _tx?: TransactionContext): Promise<void> {
    this.byId.set(reservation.id, InMemoryReservationRepository.copy(reservation));
  }

  async findExpired(now: Date, limit: number, _tx?: TransactionContext): Promise<Reservation[]> {
    return [...this.byId.values()]
      .filter((r) => r.status === 'PENDING' && r.expiresAt.getTime() <= now.getTime())
      .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime())
      .slice(0, limit)
      .map(InMemoryReservationRepository.copy);
  }

  private static copy(reservation: Reservation): Reservation {
    return Reservation.rehydrate({
      id: reservation.id,
      skuId: reservation.skuId,
      orderId: reservation.orderId,
      quantity: Quantity.of(reservation.quantity.value),
      status: reservation.status,
      expiresAt: new Date(reservation.expiresAt.getTime()),
      createdAt: new Date(reservation.createdAt.getTime()),
    });
  }
}
