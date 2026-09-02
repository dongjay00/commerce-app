import type { ErrorDto } from '@commerce/contracts';
import { type ArgumentsHost, Catch, type ExceptionFilter, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../../kernel/domain-error';
// biome-ignore lint/style/useImportType: 다른 어댑터의 DI 대상 클래스들과 동일한 값 import 패턴을 유지한다.
import { DomainErrorRegistry } from './domain-error.registry';

/**
 * 도메인 예외를 HTTP 응답으로 변환하는 유일한 지점.
 * 도메인은 HTTP를 모르고, 이 어댑터만 안다.
 *
 * `SharedModule`에 `APP_FILTER` 프로바이더로 등록되어 전역 필터로 설치된다 —
 * `@Injectable()`이 있어야 Nest DI가 `DomainErrorRegistry`를 주입해 그 방식으로
 * 생성할 수 있다.
 */
@Injectable()
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(private readonly registry: DomainErrorRegistry) {}

  catch(exception: DomainError, host: ArgumentsHost): void {
    const { status, code } = this.registry.resolve(exception.code);
    const body: ErrorDto = { code, message: exception.message };

    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
