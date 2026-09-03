import type { OrderId, SkuId } from '../../../../../shared/kernel/identifiers';
import type { Quantity } from '../../../../../shared/kernel/quantity';

export type ReserveOutcome =
  | { readonly ok: true; readonly reservationId: string; readonly expiresAt: Date }
  | { readonly ok: false; readonly reason: 'OUT_OF_STOCK' | 'SKU_UNKNOWN' };

/**
 * Inventory로 나가는 ACL (스펙 §4.2의 호출 경로).
 *
 * 재고 부족이 예외가 아니라 결과인 이유: 주문 실패의 **정상적인 이유**이고,
 * `InsufficientStockError`는 inventory의 도메인 예외라 ordering이 `instanceof`로
 * 판별하려면 Core가 Supporting의 예외 타입에 묶여야 한다.
 *
 * `release`는 보상 경로에서 쓴다 — 여러 줄을 예약하다 중간에 실패하면 이미 잡은
 * 것들을 풀어야 한다(태스크 12). 실패해도 TTL이 결국 회수하므로 예외를 던져도
 * 사가가 멈추지 않게 호출자가 감싼다.
 */
export interface InventoryReserver {
  reserve(params: { orderId: OrderId; skuId: SkuId; quantity: Quantity }): Promise<ReserveOutcome>;
  release(params: { reservationId: string }): Promise<void>;
}

export const INVENTORY_RESERVER = Symbol('InventoryReserver');
