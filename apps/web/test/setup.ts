import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../src/shared/api/msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
// Testing Library의 자동 정리는 `afterEach`가 전역으로 존재할 때만 붙는다.
// 이 프로젝트는 vitest globals를 켜지 않았으므로 직접 호출해야 한다 — 안 하면
// 같은 파일의 이전 테스트가 렌더한 DOM이 다음 테스트까지 남는다.
afterEach(() => cleanup());
afterAll(() => server.close());
