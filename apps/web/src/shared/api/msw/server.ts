import { setupServer } from 'msw/node';
import { addressHandlers } from './handlers/address';
import { authHandlers } from './handlers/auth';
import { bffHandlers } from './handlers/bff';
import { cartHandlers } from './handlers/cart';
import { healthHandlers } from './handlers/health';
import { orderHandlers } from './handlers/order';
import { productHandlers } from './handlers/product';

export const server = setupServer(
  ...healthHandlers,
  ...authHandlers,
  ...productHandlers,
  ...cartHandlers,
  ...orderHandlers,
  ...addressHandlers,
  ...bffHandlers,
);
