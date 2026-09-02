import { AggregateRoot } from '../../../shared/kernel/aggregate-root';
import type { AccountId } from '../../../shared/kernel/identifiers';
import { accountRegistered } from './account.events';
import type { Credential } from './credential';
import type { Email } from './email';

/**
 * 계정 애그리거트 루트.
 *
 * 이메일은 불변이다 — 이메일 변경 유스케이스가 범위 밖이라 setter를 만들지 않는다.
 * 만들어 두면 확인 메일 흐름 없이 이메일을 바꿀 수 있는 구멍이 된다.
 *
 * "현재 비밀번호가 맞는가"는 여기서 검사하지 않는다. 대조에는 해셔(포트)가 필요하고
 * 도메인은 포트를 부르지 않는다. 유스케이스가 대조한 뒤 `changeCredential`을 부른다.
 * 스펙 §5.5의 "본인 주문만 취소"와 갈리는 지점이다 — 그건 I/O 없이 판단할 수 있어
 * 도메인 규칙이고, 이건 I/O가 필요해 애플리케이션 규칙이다.
 */
export class Account extends AggregateRoot {
  private constructor(
    readonly id: AccountId,
    readonly email: Email,
    private credentialValue: Credential,
    readonly createdAt: Date,
    private updatedAtValue: Date,
  ) {
    super();
  }

  static register(params: {
    id: AccountId;
    email: Email;
    credential: Credential;
    now: Date;
  }): Account {
    const account = new Account(params.id, params.email, params.credential, params.now, params.now);
    account.raise(accountRegistered(params.id, params.email, params.now));
    return account;
  }

  /** 저장된 행에서 복원한다. 이벤트를 쌓지 않는다. */
  static rehydrate(params: {
    id: AccountId;
    email: Email;
    credential: Credential;
    createdAt: Date;
    updatedAt: Date;
  }): Account {
    return new Account(
      params.id,
      params.email,
      params.credential,
      params.createdAt,
      params.updatedAt,
    );
  }

  get credential(): Credential {
    return this.credentialValue;
  }

  get updatedAt(): Date {
    return this.updatedAtValue;
  }

  changeCredential(next: Credential, now: Date): void {
    this.credentialValue = next;
    this.updatedAtValue = now;
  }
}
