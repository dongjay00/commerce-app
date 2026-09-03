import type { PrismaClient } from '@prisma/client';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { ProductId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { ProductRepository } from '../../../application/ports/out/product.repository';
import type { Product } from '../../../domain/product';
import { toProductDomain, toProductRow, toSkuRows } from './product.mapper';

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: ProductId, tx?: TransactionContext): Promise<Product | null> {
    const row = await this.client(tx).product.findUnique({
      where: { id },
      include: { skus: true },
    });
    return row === null ? null : toProductDomain(row);
  }

  /**
   * 애그리거트와 SKU 목록을 함께 쓴다.
   *
   * **삭제가 핵심이다.** upsert만 하면 도메인에서 지운 SKU가 DB에 남아 다음 조회에서
   * 되살아난다. "애그리거트를 저장한다"는 말의 실제 의미가 "지금 애그리거트에 없는
   * 행은 지운다"이다.
   */
  async save(product: Product, tx?: TransactionContext): Promise<void> {
    const client = this.client(tx);
    const row = toProductRow(product);
    const skuRows = toSkuRows(product);

    await client.product.upsert({
      where: { id: row.id },
      create: row,
      update: { name: row.name, status: row.status },
    });

    await client.sku.deleteMany({
      where: { productId: row.id, id: { notIn: skuRows.map((sku) => sku.id) } },
    });

    for (const skuRow of skuRows) {
      await client.sku.upsert({ where: { id: skuRow.id }, create: skuRow, update: skuRow });
    }
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
