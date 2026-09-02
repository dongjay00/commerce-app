import { setupServer } from 'msw/node';
import { healthHandlers } from './handlers/health';

export const server = setupServer(...healthHandlers);
