import { CustomerId } from '../../../../shared/kernel/identifiers';
import { type Money, Money as MoneyVo } from '../../../../shared/kernel/money';
import type { CartLineView, CartView, GetCartQuery } from '../ports/in/queries/get-cart.query';
import type { CartRepository } from '../ports/out/cart.repository';
import type { CatalogPriceProvider } from '../ports/out/catalog-price.provider';

const ZERO_VIEW = MoneyVo.zero().toDto();

/**
 * 장바구니 조회. **`CartRepository` + `CatalogPriceProvider`로 간다** — 장바구니에는
 * 가격이 없으므로(스펙 §10.8) 현재 가격을 Catalog에서 가져와 보여준다. 주문 시점의
 * 스냅샷과 다를 수 있고, 그것이 정상이다.
 *
 * 별도 읽기 포트를 만들지 않는 이유: 조인해야 할 대상이 다른 컨텍스트라 Prisma
 * projection으로는 애초에 불가능하다. 애플리케이션 계층에서 합치는 것이 맞다.
 */
export class GetCartService implements GetCartQuery {
  constructor(
    private readonly carts: CartRepository,
    private readonly catalog: CatalogPriceProvider,
  ) {}

  async execute(command: { customerId: string }): Promise<CartView> {
    const customerId = CustomerId.of(command.customerId);
    const cart = await this.carts.findByCustomerId(customerId);
    if (cart === null || cart.isEmpty) {
      // 처음 방문한 고객의 장바구니는 "없는 것"이 아니라 "빈 것"이다. 404를 내면
      // 클라이언트가 빈 장바구니 화면을 그리지 못한다.
      return { cartId: cart?.id ?? null, lines: [], total: ZERO_VIEW, unavailableSkuIds: [] };
    }

    const priced = await this.catalog.findPrices(cart.lines.map((line) => line.skuId));
    const bySkuId = new Map(priced.map((item) => [item.skuId as string, item]));

    const available = cart.lines.flatMap((line) => {
      const item = bySkuId.get(line.skuId);
      return item === undefined ? [] : [{ line, item }];
    });
    // 판매 중지된 상품 하나 때문에 장바구니 화면 전체가 열리지 않으면 안 된다.
    const unavailableSkuIds = cart.lines
      .filter((line) => !bySkuId.has(line.skuId))
      .map((line) => line.skuId as string);

    const subtotals: Money[] = available.map(({ line, item }) =>
      item.unitPrice.multiply(line.quantity),
    );
    const lines: CartLineView[] = available.map(({ line, item }, index) => ({
      skuId: line.skuId,
      nameSnapshot: item.nameSnapshot,
      unitPrice: item.unitPrice.toDto(),
      quantity: line.quantity.value,
      subtotal: (subtotals[index] as Money).toDto(),
    }));

    return {
      cartId: cart.id,
      lines,
      // 통화가 섞이면 CurrencyMismatchError(500)가 난다. 장바구니 화면에서 그것이
      // 나는 것은 카탈로그 데이터가 잘못됐다는 뜻이고 사용자가 고칠 수 없다.
      total: MoneyVo.sum(subtotals).toDto(),
      unavailableSkuIds,
    };
  }
}
