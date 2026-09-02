import type { SessionTokens } from './sign-up.usecase';

export interface RefreshSessionCommand {
  readonly refreshToken: string;
}

export interface RefreshSessionUseCase {
  execute(command: RefreshSessionCommand): Promise<SessionTokens>;
}

export const REFRESH_SESSION_USECASE = Symbol('RefreshSessionUseCase');
