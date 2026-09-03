import type { PrismaClient } from '@prisma/client';
import type { ProductId } from '../../../../../shared/kernel/identifiers';
import type {
  ProductQuery,
  ProductView,
  SearchCriteria,
} from '../../../application/ports/out/product.query';

interface QueryRow {
  id: string;
  name: string;
  status: string;
  skus: Array<{ id: string; code: string; priceAmount: bigint; priceCurrency: string }>;
}

function toProductView(row: QueryRow): ProductView {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    skus: row.skus.map((sku) => ({
      id: sku.id,
      code: sku.code,
      // JSON에 bigint가 없다. 문자열로 옮긴다 — Number를 거치면 큰 금액이 깨진다.
      amount: sku.priceAmount.toString(),
      currency: sku.priceCurrency,
    })),
  };
}

const SKU_SELECT = { id: true, code: true, priceAmount: true, priceCurrency: true } as const;

/**
 * 조회 전용. 애그리거트를 만들지 않고 필요한 컬럼만 골라 읽기 모델로 바로 옮긴다
 * (스펙 §7.2). `Product.rehydrate`를 거치지 않으므로 불변식 검증 비용도 없다.
 */
export class PrismaProductQuery implements ProductQuery {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(productId: ProductId): Promise<ProductView | null> {
    const row = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        status: true,
        skus: { select: SKU_SELECT, orderBy: { code: 'asc' } },
      },
    });
    return row === null ? null : toProductView(row);
  }

  async search(criteria: SearchCriteria): Promise<ProductView[]> {
    const rows = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        ...(criteria.keyword === undefined
          ? {}
          : { name: { contains: criteria.keyword, mode: 'insensitive' as const } }),
      },
      select: {
        id: true,
        name: true,
        status: true,
        skus: { select: SKU_SELECT, orderBy: { code: 'asc' } },
      },
      // 정렬을 지정하지 않으면 Postgres는 순서를 보장하지 않고 목록이 새로고침마다
      // 뒤바뀐다. 이름이 같을 수 있으므로 id를 2차 키로 둬 안정 정렬을 만든다.
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: criteria.offset,
      take: criteria.limit,
    });
    return rows.map(toProductView);
  }
}
