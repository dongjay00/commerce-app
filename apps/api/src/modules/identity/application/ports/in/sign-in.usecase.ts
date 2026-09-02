import type { SessionTokens } from './sign-up.usecase';

export interface SignInCommand {
  readonly email: string;
  readonly password: string;
}

export interface SignInUseCase {
  execute(command: SignInCommand): Promise<SessionTokens>;
}

export const SIGN_IN_USECASE = Symbol('SignInUseCase');
