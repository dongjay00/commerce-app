import 'server-only';
import { createContractClient } from '../shared/api/contract-client';

/**
 * 서버 전용 API 클라이언트.
 * 계획 2에서 여기에 세션 쿠키 → 토큰 주입과 401 refresh 재시도가 들어간다.
 * 클라이언트 컴포넌트는 이 모듈을 import할 수 없다 ('server-only'가 빌드 단계에서 막는다).
 */
export const apiClient = createContractClient(process.env.API_BASE_URL ?? 'http://localhost:3001');
