import { healthContract } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';

/**
 * 응답을 계약 스키마로 parse해서 내려준다.
 * 백엔드 계약이 바뀌면 이 핸들러가 즉시 터지므로, 목이 실물과 조용히 드리프트할 수 없다.
 */
export function healthHandler(payload: unknown) {
  return http.get('*/health', () =>
    HttpResponse.json(healthContract.check.responses[200].parse(payload)),
  );
}

export const healthHandlers = [healthHandler({ status: 'ok', database: 'up' })];
