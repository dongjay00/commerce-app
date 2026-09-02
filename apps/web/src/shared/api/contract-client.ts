import { apiContract } from '@commerce/contracts';
import { type ApiFetcher, initClient } from '@ts-rest/core';

/**
 * `api`를 주지 않으면 ts-rest의 기본 fetch를 쓴다 — 인증이 필요 없는 호출(health)용이다.
 */
export function createContractClient(baseUrl: string, api?: ApiFetcher) {
  return initClient(apiContract, {
    baseUrl,
    baseHeaders: { 'Content-Type': 'application/json' },
    ...(api === undefined ? {} : { api }),
  });
}
