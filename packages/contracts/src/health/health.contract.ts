import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

export const healthContract = c.router({
  check: {
    method: 'GET',
    path: '/health',
    responses: {
      200: z.object({
        status: z.literal('ok'),
        database: z.enum(['up', 'down']),
      }),
    },
    summary: 'API와 데이터베이스 연결 상태',
  },
});
