import type { ErrorDto } from '@commerce/contracts';
import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../../kernel/domain-error';
// biome-ignore lint/style/useImportType: 다른 어댑터의 DI 대상 클래스들과 동일한 값 import 패턴을 유지한다.
import { DomainErrorRegistry } from './domain-error.registry';

/**
 * 도메인 예외를 HTTP 응답으로 변환하는 유일한 지점.
 * 도메인은 HTTP를 모르고, 이 어댑터만 안다.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(private readonly registry: DomainErrorRegistry) {}

  catch(exception: DomainError, host: ArgumentsHost): void {
    const { status, code } = this.registry.resolve(exception.code);
    const body: ErrorDto = { code, message: exception.message };

    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
