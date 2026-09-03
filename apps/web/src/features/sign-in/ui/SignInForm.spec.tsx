import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '@/shared/api/msw/server';
import { SignInForm } from './SignInForm';

describe('SignInForm', () => {
  it('이메일·비밀번호를 입력하고 제출하면 요청이 나간다', async () => {
    let requestBody: unknown;
    server.use(
      http.post('/api/auth/sign-in', async ({ request }) => {
        requestBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const onSuccess = vi.fn();
    render(<SignInForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText('이메일'), {
      target: { value: 'a@example.com' },
    });
    fireEvent.change(screen.getByLabelText('비밀번호'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() =>
      expect(requestBody).toEqual({
        email: 'a@example.com',
        password: 'correct horse battery staple',
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('실패하면 role="alert"에 문구가 보인다', async () => {
    server.use(
      http.post('/api/auth/sign-in', () =>
        HttpResponse.json(
          { code: 'INVALID_CREDENTIALS', message: '자격 증명이 올바르지 않습니다.' },
          { status: 401 },
        ),
      ),
    );
    render(<SignInForm />);

    fireEvent.change(screen.getByLabelText('이메일'), {
      target: { value: 'a@example.com' },
    });
    fireEvent.change(screen.getByLabelText('비밀번호'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이메일 또는 비밀번호가 올바르지 않습니다.',
    );
  });

  it('요청 중에는 버튼이 disabled다', async () => {
    let resolveRequest: (() => void) | undefined;
    server.use(
      http.post('/api/auth/sign-in', async () => {
        await new Promise<void>((resolve) => {
          resolveRequest = resolve;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<SignInForm />);

    fireEvent.change(screen.getByLabelText('이메일'), {
      target: { value: 'a@example.com' },
    });
    fireEvent.change(screen.getByLabelText('비밀번호'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled());

    resolveRequest?.();
    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());
  });
});
