import type { OrderId, SkuId } from '../../../shared/kernel/identifiers';
import type { Quantity } from '../../../shared/kernel/quantity';
import type {
  InventoryReserver,
  ReserveOutcome,
} from '../application/ports/out/inventory-reserver';

/**
 * 예약 결과를 SKU별로 지정할 수 있고 **호출 이력을 남긴다.**
 *
 * 이력이 이 fake의 존재 이유다. 태스크 12의 "3번째 줄 예약이 실패하면 1·2번째를
 * 푼다"는 `released`를 보지 않고는 검증할 수 없고, 목 라이브러리의 자동 스텁으로는
 * 그 순서를 확인하기 어렵다(스펙 §9.1).
 */
export class FakeInventoryReserver implements InventoryReserver {
  readonly reserved: Array<{ orderId: string; skuId: string; quantity: number }> = [];
  readonly released: string[] = [];

  private readonly failures = new Map<string, 'OUT_OF_STOCK' | 'SKU_UNKNOWN'>();
  private releaseError: Error | null = null;
  private sequence = 0;

  failFor(skuId: SkuId, reason: 'OUT_OF_STOCK' | 'SKU_UNKNOWN' = 'OUT_OF_STOCK'): this {
    this.failures.set(skuId, reason);
    return this;
  }

  /** 보상 자체가 실패하는 경우를 만든다 — TTL이 마지막 그물임을 확인할 때 쓴다. */
  failReleaseWith(error: Error): this {
    this.releaseError = error;
    return this;
  }

  async reserve(params: {
    orderId: OrderId;
    skuId: SkuId;
    quantity: Quantity;
  }): Promise<ReserveOutcome> {
    const failure = this.failures.get(params.skuId);
    if (failure !== undefined) {
      return { ok: false, reason: failure };
    }
    this.sequence += 1;
    this.reserved.push({
      orderId: params.orderId,
      skuId: params.skuId,
      quantity: params.quantity.value,
    });
    return {
      ok: true,
      reservationId: `reservation-${this.sequence}`,
      expiresAt: new Date('2026-03-01T00:15:00.000Z'),
    };
  }

  async release(params: { reservationId: string }): Promise<void> {
    if (this.releaseError !== null) {
      throw this.releaseError;
    }
    this.released.push(params.reservationId);
  }
}
