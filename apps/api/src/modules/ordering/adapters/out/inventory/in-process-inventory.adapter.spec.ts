import { describe, expect, it } from 'vitest';
import { OrderId, SkuId } from '../../../../../shared/kernel/identifiers';
import { Quantity } from '../../../../../shared/kernel/quantity';
import type {
  ReleaseReservationUseCase,
  ReserveStockCommand,
  ReserveStockUseCase,
} from '../../../../inventory';
import { INSUFFICIENT_STOCK_CODE, STOCK_NOT_FOUND_CODE } from '../../../../inventory';
import { orderUuid, skuUuid } from '../../../testing/ordering.fixtures';
import { InProcessInventoryAdapter } from './in-process-inventory.adapter';

/** `code` 필드를 가진 예외. inventory의 DomainError와 같은 모양이다. */
class CodedError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

class FakeReserveStock implements ReserveStockUseCase {
  constructor(private readonly failure: Error | null = null) {}

  async execute(_command: ReserveStockCommand) {
    if (this.failure !== null) {
      throw this.failure;
    }
    return { reservationId: 'reservation-1', expiresAt: new Date('2026-03-01T00:15:00.000Z') };
  }
}

class FakeReleaseReservation implements ReleaseReservationUseCase {
  readonly released: string[] = [];

  async execute(command: { reservationId: string }): Promise<void> {
    this.released.push(command.reservationId);
  }
}

const reserve = (failure: Error | null = null) =>
  new InProcessInventoryAdapter(
    new FakeReserveStock(failure),
    new FakeReleaseReservation(),
  ).reserve({
    orderId: OrderId.of(orderUuid('1')),
    skuId: SkuId.of(skuUuid('1')),
    quantity: Quantity.positive(2),
  });

describe('InProcessInventoryAdapter', () => {
  it('성공하면 ok: true와 예약 정보를 돌려준다', async () => {
    expect(await reserve()).toEqual({
      ok: true,
      reservationId: 'reservation-1',
      expiresAt: new Date('2026-03-01T00:15:00.000Z'),
    });
  });

  it('재고 부족 코드는 OUT_OF_STOCK으로 번역된다', async () => {
    expect(await reserve(new CodedError(INSUFFICIENT_STOCK_CODE))).toEqual({
      ok: false,
      reason: 'OUT_OF_STOCK',
    });
  });

  it('재고 없음 코드는 SKU_UNKNOWN으로 번역된다', async () => {
    expect(await reserve(new CodedError(STOCK_NOT_FOUND_CODE))).toEqual({
      ok: false,
      reason: 'SKU_UNKNOWN',
    });
  });

  it('그 밖의 예외는 그대로 던진다', async () => {
    // 삼키면 DB 장애가 "재고 부족"으로 둔갑하고 진짜 원인이 어디에도 남지 않는다.
    await expect(reserve(new Error('연결이 끊겼습니다'))).rejects.toThrow('연결이 끊겼습니다');
  });

  it('code가 없는 예외도 그대로 던진다', async () => {
    await expect(reserve(new CodedError('SOMETHING_ELSE'))).rejects.toThrow('SOMETHING_ELSE');
  });

  it('release를 위임한다', async () => {
    const release = new FakeReleaseReservation();
    const adapter = new InProcessInventoryAdapter(new FakeReserveStock(), release);

    await adapter.release({ reservationId: 'reservation-7' });

    expect(release.released).toEqual(['reservation-7']);
  });
});
