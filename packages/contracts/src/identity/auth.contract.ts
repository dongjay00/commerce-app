import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorDtoSchema } from '../shared/error-codes';

const c = initContract();

// 비밀번호의 상한 1024는 **형식** 제약이다 — 임의 길이 입력을 Argon2에 그대로 넘기면
// 해싱 비용이 입력 길이에 비례해 커진다. 실제 정책(10~128자)은 PlainPassword VO가 지킨다.
const passwordField = z.string().min(1).max(1024);
const emailField = z.string().email().max(254);

export const signUpBodySchema = z.object({ email: emailField, password: passwordField }).strict();

export const signInBodySchema = z.object({ email: emailField, password: passwordField }).strict();

export const refreshBodySchema = z.object({ refreshToken: z.string().min(1) }).strict();

export const changePasswordBodySchema = z
  .object({ currentPassword: passwordField, newPassword: passwordField })
  .strict();

export const sessionTokensSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresInSeconds: z.number().int().positive(),
  })
  .strict();

export type SignUpBody = z.infer<typeof signUpBodySchema>;
export type SignInBody = z.infer<typeof signInBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
export type SessionTokensDto = z.infer<typeof sessionTokensSchema>;

export const authContract = c.router({
  signUp: {
    method: 'POST',
    path: '/auth/sign-up',
    body: signUpBodySchema,
    responses: {
      201: sessionTokensSchema,
      400: errorDtoSchema, // VALIDATION_FAILED
      409: errorDtoSchema, // EMAIL_ALREADY_REGISTERED
      422: errorDtoSchema, // PASSWORD_POLICY_VIOLATED
    },
    summary: '이메일과 비밀번호로 가입하고 즉시 세션을 발급받는다',
  },
  signIn: {
    method: 'POST',
    path: '/auth/sign-in',
    body: signInBodySchema,
    responses: {
      200: sessionTokensSchema,
      401: errorDtoSchema, // INVALID_CREDENTIALS
    },
    summary: '로그인',
  },
  refresh: {
    method: 'POST',
    path: '/auth/refresh',
    body: refreshBodySchema,
    responses: {
      200: sessionTokensSchema,
      401: errorDtoSchema, // UNAUTHENTICATED — 만료·폐기·미존재를 모두 포함
    },
    summary: '리프레시 토큰을 회전시켜 새 세션을 받는다',
  },
  signOut: {
    method: 'POST',
    path: '/auth/sign-out',
    body: refreshBodySchema,
    responses: {
      204: c.noBody(),
    },
    summary: '세션을 폐기한다. 이미 없는 토큰이어도 204 (멱등)',
  },
  changePassword: {
    method: 'POST',
    path: '/auth/change-password',
    body: changePasswordBodySchema,
    responses: {
      204: c.noBody(),
      401: errorDtoSchema, // UNAUTHENTICATED 또는 INVALID_CREDENTIALS
      422: errorDtoSchema, // PASSWORD_POLICY_VIOLATED
    },
    summary: '비밀번호를 변경하고 다른 모든 세션을 폐기한다',
  },
});
