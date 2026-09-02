import { Module } from '@nestjs/common';
import { JwtTokenService } from '../../shared/infrastructure/auth/jwt-token.service';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 모듈 생성자 주입이 깨진다. (JwtTokenService·PrismaService는 아래 inject 배열에서 값으로도 쓰여 이미 안전하다)
import { DomainErrorRegistry } from '../../shared/infrastructure/http/domain-error.registry';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import type { Duration } from '../../shared/kernel/duration';
import { CLOCK, type Clock } from '../../shared/kernel/ports/clock';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../shared/kernel/ports/domain-event.publisher';
import { ID_GENERATOR, type IdGenerator } from '../../shared/kernel/ports/id-generator';
import {
  TRANSACTION_MANAGER,
  type TransactionManager,
} from '../../shared/kernel/ports/transaction-manager';
import {
  CustomerModule,
  FIND_CUSTOMER_BY_ACCOUNT_QUERY,
  type FindCustomerByAccountQuery,
  PROVISION_CUSTOMER_USECASE,
  type ProvisionCustomerUseCase,
} from '../customer';
import { AuthController } from './adapters/in/http/auth.controller';
import { registerIdentityDomainErrors } from './adapters/in/http/identity-domain-error-mappings';
import { InProcessCustomerAdapter } from './adapters/out/customer/in-process-customer.adapter';
import { ConsoleEmailSender } from './adapters/out/email/console-email.sender';
import { Argon2PasswordHasher } from './adapters/out/hashing/argon2-password.hasher';
import { PrismaAccountRepository } from './adapters/out/persistence/prisma-account.repository';
import { PrismaSessionRepository } from './adapters/out/persistence/prisma-session.repository';
import { JwtTokenIssuer } from './adapters/out/token/jwt-token.issuer';
import { CHANGE_PASSWORD_USECASE } from './application/ports/in/change-password.usecase';
import { REFRESH_SESSION_USECASE } from './application/ports/in/refresh-session.usecase';
import { SIGN_IN_USECASE } from './application/ports/in/sign-in.usecase';
import { SIGN_OUT_USECASE } from './application/ports/in/sign-out.usecase';
import { SIGN_UP_USECASE } from './application/ports/in/sign-up.usecase';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from './application/ports/out/account.repository';
import {
  CUSTOMER_DIRECTORY,
  type CustomerDirectory,
} from './application/ports/out/customer-directory';
import { EMAIL_SENDER, type EmailSender } from './application/ports/out/email-sender';
import { PASSWORD_HASHER, type PasswordHasher } from './application/ports/out/password-hasher';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from './application/ports/out/session.repository';
import { TOKEN_ISSUER, type TokenIssuer } from './application/ports/out/token-issuer';
import { ChangePasswordService } from './application/services/change-password.service';
import { RefreshSessionService } from './application/services/refresh-session.service';
import { SignInService } from './application/services/sign-in.service';
import { SignOutService } from './application/services/sign-out.service';
import { SignUpService } from './application/services/sign-up.service';
import { readRefreshTtl } from './refresh-ttl.config';

const REFRESH_TTL = Symbol('RefreshTtl');

@Module({
  // 이 한 줄이 스펙 §4.2의 호출 경로를 만든다. 반대 방향(customer → identity)은
  // 존재하지 않으며, no-circular가 그것을 강제한다.
  imports: [CustomerModule],
  controllers: [AuthController],
  providers: [
    { provide: REFRESH_TTL, useFactory: () => readRefreshTtl(process.env) },

    {
      provide: ACCOUNT_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PrismaAccountRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: SESSION_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PrismaSessionRepository(prisma),
      inject: [PrismaService],
    },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    {
      provide: TOKEN_ISSUER,
      useFactory: (jwt: JwtTokenService) => new JwtTokenIssuer(jwt),
      inject: [JwtTokenService],
    },
    {
      // useClass를 쓰지 않는다 — ConsoleEmailSender의 생성자 파라미터에 기본값이 있어
      // Nest가 그 자리를 주입 대상으로 보고 해석에 실패한다.
      provide: EMAIL_SENDER,
      useFactory: () => new ConsoleEmailSender(),
    },
    {
      provide: CUSTOMER_DIRECTORY,
      useFactory: (
        provisionCustomer: ProvisionCustomerUseCase,
        findCustomerByAccount: FindCustomerByAccountQuery,
      ) => new InProcessCustomerAdapter(provisionCustomer, findCustomerByAccount),
      inject: [PROVISION_CUSTOMER_USECASE, FIND_CUSTOMER_BY_ACCOUNT_QUERY],
    },

    {
      provide: SIGN_UP_USECASE,
      useFactory: (
        accounts: AccountRepository,
        sessions: SessionRepository,
        customers: CustomerDirectory,
        hasher: PasswordHasher,
        tokens: TokenIssuer,
        emails: EmailSender,
        transactions: TransactionManager,
        clock: Clock,
        ids: IdGenerator,
        events: DomainEventPublisher,
        refreshTtl: Duration,
      ) =>
        new SignUpService(
          accounts,
          sessions,
          customers,
          hasher,
          tokens,
          emails,
          transactions,
          clock,
          ids,
          events,
          refreshTtl,
        ),
      inject: [
        ACCOUNT_REPOSITORY,
        SESSION_REPOSITORY,
        CUSTOMER_DIRECTORY,
        PASSWORD_HASHER,
        TOKEN_ISSUER,
        EMAIL_SENDER,
        TRANSACTION_MANAGER,
        CLOCK,
        ID_GENERATOR,
        DOMAIN_EVENT_PUBLISHER,
        REFRESH_TTL,
      ],
    },
    {
      provide: SIGN_IN_USECASE,
      useFactory: (
        accounts: AccountRepository,
        sessions: SessionRepository,
        customers: CustomerDirectory,
        hasher: PasswordHasher,
        tokens: TokenIssuer,
        clock: Clock,
        ids: IdGenerator,
        refreshTtl: Duration,
      ) => new SignInService(accounts, sessions, customers, hasher, tokens, clock, ids, refreshTtl),
      inject: [
        ACCOUNT_REPOSITORY,
        SESSION_REPOSITORY,
        CUSTOMER_DIRECTORY,
        PASSWORD_HASHER,
        TOKEN_ISSUER,
        CLOCK,
        ID_GENERATOR,
        REFRESH_TTL,
      ],
    },
    {
      provide: REFRESH_SESSION_USECASE,
      useFactory: (
        sessions: SessionRepository,
        customers: CustomerDirectory,
        tokens: TokenIssuer,
        clock: Clock,
        refreshTtl: Duration,
      ) => new RefreshSessionService(sessions, customers, tokens, clock, refreshTtl),
      inject: [SESSION_REPOSITORY, CUSTOMER_DIRECTORY, TOKEN_ISSUER, CLOCK, REFRESH_TTL],
    },
    {
      provide: SIGN_OUT_USECASE,
      useFactory: (sessions: SessionRepository, tokens: TokenIssuer, clock: Clock) =>
        new SignOutService(sessions, tokens, clock),
      inject: [SESSION_REPOSITORY, TOKEN_ISSUER, CLOCK],
    },
    {
      provide: CHANGE_PASSWORD_USECASE,
      useFactory: (
        accounts: AccountRepository,
        sessions: SessionRepository,
        hasher: PasswordHasher,
        transactions: TransactionManager,
        clock: Clock,
      ) => new ChangePasswordService(accounts, sessions, hasher, transactions, clock),
      inject: [ACCOUNT_REPOSITORY, SESSION_REPOSITORY, PASSWORD_HASHER, TRANSACTION_MANAGER, CLOCK],
    },
  ],
})
export class IdentityModule {
  constructor(registry: DomainErrorRegistry) {
    registerIdentityDomainErrors(registry);
  }
}
