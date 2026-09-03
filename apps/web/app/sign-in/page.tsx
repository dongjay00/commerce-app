'use client';

import { useRouter } from 'next/navigation';
import { SignInForm } from '@/features/sign-in';

export default function SignInPage() {
  const router = useRouter();
  return (
    <SignInForm
      onSuccess={() => {
        // refresh가 있어야 Header가 로그인 상태를 다시 읽는다 — RSC 캐시를 비운다.
        router.push('/');
        router.refresh();
      }}
    />
  );
}
