export interface HandlePgCallbackCommand {
  readonly orderId: string;
  readonly pgTxId: string;
  readonly result: 'APPROVED' | 'DECLINED';
  readonly reason?: string;
}

export interface HandlePgCallbackUseCase {
  /** 처음 보는 콜백이면 `true`. 이미 처리된 `pgTxId`면 `false`. */
  execute(command: HandlePgCallbackCommand): Promise<boolean>;
}

export const HANDLE_PG_CALLBACK_USECASE = Symbol('HandlePgCallbackUseCase');
