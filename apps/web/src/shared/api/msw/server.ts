import { setupServer } from 'msw/node';
import { authHandlers } from './handlers/auth';
import { healthHandlers } from './handlers/health';

export const server = setupServer(...healthHandlers, ...authHandlers);
