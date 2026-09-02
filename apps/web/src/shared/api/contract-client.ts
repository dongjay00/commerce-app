import { healthContract } from '@commerce/contracts';
import { initClient } from '@ts-rest/core';

export function createContractClient(baseUrl: string) {
  return initClient(healthContract, {
    baseUrl,
    baseHeaders: { 'Content-Type': 'application/json' },
  });
}
