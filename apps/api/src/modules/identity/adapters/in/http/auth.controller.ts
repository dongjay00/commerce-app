import {
  type ChangePasswordBody,
  changePasswordBodySchema,
  type RefreshBody,
  refreshBodySchema,
  type SessionTokensDto,
  type SignInBody,
  type SignUpBody,
  signInBodySchema,
  signUpBodySchema,
} from '@commerce/contracts';
import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../../../../../shared/infrastructure/http/access-token.guard';
import { CurrentPrincipal } from '../../../../../shared/infrastructure/http/current-principal.decorator';
import { ZodValidationPipe } from '../../../../../shared/infrastructure/http/zod-validation.pipe';
import type { Principal } from '../../../../../shared/kernel/ports/access-token-verifier';
import {
  CHANGE_PASSWORD_USECASE,
  type ChangePasswordUseCase,
} from '../../../application/ports/in/change-password.usecase';
import {
  REFRESH_SESSION_USECASE,
  type RefreshSessionUseCase,
} from '../../../application/ports/in/refresh-session.usecase';
import { SIGN_IN_USECASE, type SignInUseCase } from '../../../application/ports/in/sign-in.usecase';
import {
  SIGN_OUT_USECASE,
  type SignOutUseCase,
} from '../../../application/ports/in/sign-out.usecase';
import { SIGN_UP_USECASE, type SignUpUseCase } from '../../../application/ports/in/sign-up.usecase';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(SIGN_UP_USECASE) private readonly signUp: SignUpUseCase,
    @Inject(SIGN_IN_USECASE) private readonly signIn: SignInUseCase,
    @Inject(REFRESH_SESSION_USECASE) private readonly refreshSession: RefreshSessionUseCase,
    @Inject(SIGN_OUT_USECASE) private readonly signOut: SignOutUseCase,
    @Inject(CHANGE_PASSWORD_USECASE) private readonly changePassword: ChangePasswordUseCase,
  ) {}

  @Post('sign-up')
  @HttpCode(201)
  async postSignUp(
    @Body(new ZodValidationPipe(signUpBodySchema)) body: SignUpBody,
  ): Promise<SessionTokensDto> {
    return this.signUp.execute(body);
  }

  @Post('sign-in')
  @HttpCode(200)
  async postSignIn(
    @Body(new ZodValidationPipe(signInBodySchema)) body: SignInBody,
  ): Promise<SessionTokensDto> {
    return this.signIn.execute(body);
  }

  @Post('refresh')
  @HttpCode(200)
  async postRefresh(
    @Body(new ZodValidationPipe(refreshBodySchema)) body: RefreshBody,
  ): Promise<SessionTokensDto> {
    return this.refreshSession.execute(body);
  }

  @Post('sign-out')
  @HttpCode(204)
  async postSignOut(
    @Body(new ZodValidationPipe(refreshBodySchema)) body: RefreshBody,
  ): Promise<void> {
    // 인증을 요구하지 않는다. 액세스 토큰이 이미 만료된 상태에서도 로그아웃할 수
    // 있어야 하고, 리프레시 토큰 소지 자체가 그 세션에 대한 권한이다.
    await this.signOut.execute(body);
  }

  @Post('change-password')
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async postChangePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(changePasswordBodySchema)) body: ChangePasswordBody,
  ): Promise<void> {
    // accountId는 **요청 본문이 아니라 토큰에서** 온다. 본문에서 받으면 남의 계정
    // 비밀번호를 바꿀 수 있다. 스프레드 순서도 방어선이다 — accountId를 뒤에 둬서
    // 스키마가 나중에 그 필드를 허용하게 바뀌어도 토큰 값이 항상 이긴다.
    await this.changePassword.execute({ ...body, accountId: principal.accountId });
  }
}
