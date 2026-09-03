import { SkuId } from '../../../../shared/kernel/identifiers';
import { StockNotFoundError } from '../../domain/stock.errors';
import type { GetStockQuery, StockView } from '../ports/in/queries/get-stock.query';
import type { StockRepository } from '../ports/out/stock.repository';

/**
 * **조회인데 애그리거트를 거친다** — 스펙 §7.2("조회는 애그리거트를 거치지 않는다")에서
 * 의도적으로 벗어나는 자리다.
 *
 * Catalog는 `ProductQuery`라는 별도 읽기 포트를 뒀다. 거기서는 그럴 이유가 있었다:
 * 검색·페이징·목록이 있고, SKU 배열을 조립하는 비용이 실재한다. 재고는 필드가 셋뿐이고
 * `available`은 파생값이라, 읽기 포트를 하나 더 만들면 어댑터가 셋으로 늘고
 * (in-memory·비관적·낙관적) 계약 스위트도 하나 더 생긴다. 얻는 것이 없다.
 *
 * 스펙 §7.7의 기준으로 판정한 결과다: "테스트에서 바꿔치기해야 하는가, 혹은 나중에
 * 교체될 수 있는가. 둘 다 아니면 포트가 아니다." 목록이나 필터가 생기면 그때 가른다.
 */
export class GetStockService implements GetStockQuery {
  constructor(private readonly stocks: StockRepository) {}

  async execute(params: { skuId: string }): Promise<StockView> {
    const skuId = SkuId.of(params.skuId);
    const stock = await this.stocks.findBySkuId(skuId);
    if (stock === null) {
      throw new StockNotFoundError(skuId);
    }
    return {
      skuId: stock.skuId,
      onHand: stock.onHand.value,
      reserved: stock.reserved.value,
      available: stock.available.value,
    };
  }
}
