import { appAlert, expect, signIn, test } from './fixtures';

test('가입한 사용자가 로그인하고 로그아웃한다', async ({ page, api }) => {
  const { email, password } = await api.signUp();

  await signIn(page, { email, password });

  // 로그인하면 헤더가 바뀐다 — 세션 쿠키가 실제로 심겼다는 증거다.
  await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible();
  await expect(page.getByRole('link', { name: '로그인' })).toHaveCount(0);

  await page.getByRole('button', { name: '로그아웃' }).click();

  await expect(page.getByRole('link', { name: '로그인' })).toBeVisible();
});

test('잘못된 비밀번호로는 로그인할 수 없다', async ({ page, api }) => {
  const { email } = await api.signUp();

  await page.goto('/sign-in');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill('wrong password entirely');
  await page.getByRole('button', { name: '로그인' }).click();

  // 스펙 §8.6: 프론트가 코드로 분기해 우리 문구를 보여준다.
  // `appAlert`로 좁히는 이유는 그 헬퍼의 주석에 있다.
  await expect(appAlert(page)).toHaveText('이메일 또는 비밀번호가 올바르지 않습니다.');
  await expect(page.getByRole('button', { name: '로그아웃' })).toHaveCount(0);
});

test('로그인하지 않으면 장바구니가 로그인 화면으로 보낸다', async ({ page }) => {
  await page.goto('/cart');

  await expect(page).toHaveURL(/\/sign-in$/);
});
