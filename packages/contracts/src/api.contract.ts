import { initContract } from '@ts-rest/core';
import { productContract } from './catalog/product.contract';
import { addressContract } from './customer/address.contract';
import { healthContract } from './health/health.contract';
import { authContract } from './identity/auth.contract';
import { stockContract } from './inventory/stock.contract';

const c = initContract();

/**
 * BFF가 쓰는 단일 진입점. 클라이언트를 계약마다 만들지 않기 위해 하나로 합친다.
 * Nest 쪽은 계약별로 컨트롤러를 나누므로 이 루트를 쓰지 않는다.
 */
export const apiContract = c.router({
  health: healthContract,
  auth: authContract,
  address: addressContract,
  product: productContract,
  stock: stockContract,
});
