import { Inject, Injectable } from '@nestjs/common';
import type { OrderId, SkuId } from '../../../../../shared/kernel/identifiers';
import type { Quantity } from '../../../../../shared/kernel/quantity';
import {
  INSUFFICIENT_STOCK_CODE,
  RELEASE_RESERVATION_USECASE,
  RESERVE_STOCK_USECASE,
  type ReleaseReservationUseCase,
  type ReserveStockUseCase,
  STOCK_NOT_FOUND_CODE,
} from '../../../../inventory';
import type {
  InventoryReserver,
  ReserveOutcome,
} from '../../../application/ports/out/inventory-reserver';

/**
 * Inventory로 나가는 ACL (스펙 §4.2). **스펙 §13의 성공 기준이 이 파일을 지목한다** —
 * "`InProcessInventoryAdapter` 한 파일만 고쳐 Inventory 호출 경로를 바꿀 수 있음".
 *
 * inventory의 도메인 예외를 ordering의 결과 유니온으로 번역하는 것이 ACL의 일이다.
 * 판별을 **구조적으로**(`code` 필드) 한다 — 예외 **클래스**를 import하면 Core가
 * Supporting의 타입에 묶여 Inventory를 별도 프로세스로 떼어낼 때 그 클래스가 경계를
 * 넘어야 한다. 대신 inventory가 **코드 문자열 상수만** 공개 API로 내보내고 여기서
 * 그것을 import한다 — 문자열을 여기 복붙하면 inventory가 코드를 바꿀 때 조용히
 * 어긋나 재고 부족이 500으로 나간다. 출처가 하나면 그 회귀가 불가능하다.
 */
@Injectable()
export class InProcessInventoryAdapter implements InventoryReserver {
  constructor(
    @Inject(RESERVE_STOCK_USECASE) private readonly reserveStock: ReserveStockUseCase,
    @Inject(RELEASE_RESERVATION_USECASE)
    private readonly releaseReservation: ReleaseReservationUseCase,
  ) {}

  async reserve(params: {
    orderId: OrderId;
    skuId: SkuId;
    quantity: Quantity;
  }): Promise<ReserveOutcome> {
    try {
      const { reservationId, expiresAt } = await this.reserveStock.execute({
        skuId: params.skuId,
        orderId: params.orderId,
        quantity: params.quantity.value,
      });
      return { ok: true, reservationId, expiresAt };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === INSUFFICIENT_STOCK_CODE) {
        return { ok: false, reason: 'OUT_OF_STOCK' };
      }
      if (code === STOCK_NOT_FOUND_CODE) {
        return { ok: false, reason: 'SKU_UNKNOWN' };
      }
      // 그 밖의 예외는 진짜 오류다. 삼키면 DB 장애가 "재고 부족"으로 둔갑하고
      // 사가는 정상적으로 주문을 실패 처리하며 진짜 원인은 어디에도 남지 않는다.
      throw error;
    }
  }

  async release(params: { reservationId: string }): Promise<void> {
    await this.releaseReservation.execute({ reservationId: params.reservationId });
  }
}
