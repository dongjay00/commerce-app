import type { SkuId } from '../../../../../shared/kernel/identifiers';
import { StockAlreadyExistsError } from '../../../domain/stock.errors';

/** Prisma가 유니크 제약 위반에 쓰는 코드. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * `stock_items`의 기본키 충돌을 도메인 예외로 번역한다.
 *
 * 판별을 **구조적으로** 한다 — `Prisma.PrismaClientKnownRequestError`를 import하면
 * 이 파일이 Prisma 내부 클래스 구조에 묶이고, Prisma 7의 클라이언트는 Proxy라
 * `instanceof`가 성립하지 않는 경우가 있다(계획 1의 `app.module.spec.ts`).
 *
 * 계획 2의 `PrismaAccountRepository`와 달리 **어떤 컬럼이 충돌했는지 보지 않는다.**
 * `stock_items`에는 유니크 제약이 기본키 하나뿐이라 P2002면 그것 말고 다른 원인이 없다.
 * 제약이 하나 더 생기면 그때 계정 쪽처럼 `meta`를 훑어 갈라야 한다.
 */
export function translateStockUniqueViolation(error: unknown, skuId: SkuId): never {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown };
    if (candidate.code === UNIQUE_VIOLATION) {
      throw new StockAlreadyExistsError(skuId);
    }
  }
  throw error;
}
