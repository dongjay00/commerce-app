'use client';

import { type FormEvent, useState } from 'react';
import { useSignIn } from '../model/use-sign-in';

export function SignInForm({ onSuccess }: { onSuccess?: () => void }) {
  const { signIn, pending, error } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (await signIn({ email, password })) {
      onSuccess?.();
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>로그인</h1>
      <label>
        이메일
        <input
          type="email"
          name="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        비밀번호
        <input
          type="password"
          name="password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error === null ? null : <p role="alert">{error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? '로그인 중…' : '로그인'}
      </button>
    </form>
  );
}
