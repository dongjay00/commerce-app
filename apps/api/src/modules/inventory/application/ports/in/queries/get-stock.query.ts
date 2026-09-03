export interface StockView {
  readonly skuId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
}

export interface GetStockQuery {
  execute(params: { skuId: string }): Promise<StockView>;
}

export const GET_STOCK_QUERY = Symbol('GetStockQuery');
