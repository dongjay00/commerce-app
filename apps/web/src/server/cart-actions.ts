import 'server-only';
import type { AddCartItemBody, ChangeCartItemBody } from '@commerce/contracts';
import { type ActionResult, readActionResult } from '../shared/lib/api-error';
import { authedFetch } from './api-client';
import type { BffDeps } from './bff-deps';

export async function addCartItemAction(
  input: AddCartItemBody,
  deps: BffDeps,
): Promise<ActionResult> {
  const response = await authedFetch(deps.baseUrl, deps.store)('/cart/items', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return readActionResult(response);
}

export async function changeCartItemAction(
  skuId: string,
  input: ChangeCartItemBody,
  deps: BffDeps,
): Promise<ActionResult> {
  const response = await authedFetch(deps.baseUrl, deps.store)(`/cart/items/${skuId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return readActionResult(response);
}

export async function removeCartItemAction(skuId: string, deps: BffDeps): Promise<ActionResult> {
  const response = await authedFetch(deps.baseUrl, deps.store)(`/cart/items/${skuId}`, {
    method: 'DELETE',
  });
  return readActionResult(response);
}
