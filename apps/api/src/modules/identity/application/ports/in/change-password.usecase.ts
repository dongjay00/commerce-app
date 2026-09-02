import type { AccountId } from '../../../../../shared/kernel/identifiers';

export interface ChangePasswordCommand {
  /** 인증된 principal에서 온다. 요청 본문에서 오지 않는다. */
  readonly accountId: AccountId;
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface ChangePasswordUseCase {
  execute(command: ChangePasswordCommand): Promise<void>;
}

export const CHANGE_PASSWORD_USECASE = Symbol('ChangePasswordUseCase');
