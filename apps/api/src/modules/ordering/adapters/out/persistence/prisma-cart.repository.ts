import type { PrismaClient } from '@prisma/client';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { CartId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { CartRepository } from '../../../application/ports/out/cart.repository';
import type { Cart } from '../../../domain/cart/cart';
import { toCartDomain } from './cart.mapper';

export class PrismaCartRepository implements CartRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByCustomerId(customerId: CustomerId, tx?: TransactionContext): Promise<Cart | null> {
    const row = await this.client(tx).cart.findUnique({
      where: { customerId },
      include: { lines: true },
    });
    return row === null ? null : toCartDomain(row);
  }

  /**
   * **라인을 통째로 갈아끼운다.** append-only면 줄을 뺀 것이 저장본에 반영되지 않고,
   * 수량 변경은 `(cart_id, sku_id)` 기본키에 걸려 P2002로 죽는다.
   *
   * `createdAt`/`updatedAt`의 `new Date()`가 이 파일에서 유일하게 `Clock`을 우회하는
   * 지점이다. 감사용 메타데이터이고 도메인 판단에 쓰이지 않는다.
   */
  async save(cart: Cart, tx?: TransactionContext): Promise<void> {
    const client = this.client(tx);
    const now = new Date();

    await client.cart.upsert({
      where: { id: cart.id },
      create: { id: cart.id, customerId: cart.customerId, createdAt: now, updatedAt: now },
      update: { updatedAt: now },
    });
    await client.cartLine.deleteMany({ where: { cartId: cart.id } });
    if (cart.lines.length > 0) {
      await client.cartLine.createMany({
        data: cart.lines.map((line) => ({
          cartId: cart.id,
          skuId: line.skuId,
          quantity: line.quantity.value,
        })),
      });
    }
  }

  /**
   * `deleteMany`를 쓴다 — `delete`는 없는 행에 P2025를 던지고, 주문이 두 번
   * 처리될 때(at-least-once) 두 번째가 500이 된다.
   */
  async delete(cartId: CartId, tx?: TransactionContext): Promise<void> {
    await this.client(tx).cart.deleteMany({ where: { id: cartId } });
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
