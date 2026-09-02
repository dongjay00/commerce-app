import { describe, expect, it } from 'vitest';
import { Credential } from '../../../domain/credential';
import { PlainPassword } from '../../../domain/plain-password';
import { Argon2PasswordHasher } from './argon2-password.hasher';

const PASSWORD = PlainPassword.of('correct horse battery staple');
const OTHER = PlainPassword.of('another valid password 42');

describe('Argon2PasswordHasher', () => {
  it('해시가 평문을 포함하지 않는다', async () => {
    const credential = await new Argon2PasswordHasher().hash(PASSWORD);
    expect(credential.hash).not.toContain('horse');
  });

  it('argon2id 형식의 해시를 만든다', async () => {
    const credential = await new Argon2PasswordHasher().hash(PASSWORD);
    expect(credential.hash.startsWith('$argon2id$')).toBe(true);
  });

  it('같은 비밀번호도 매번 다른 해시가 된다 (솔트)', async () => {
    // 솔트가 없으면 같은 비밀번호를 쓰는 계정들이 DB에서 한눈에 묶인다.
    const hasher = new Argon2PasswordHasher();
    const a = await hasher.hash(PASSWORD);
    const b = await hasher.hash(PASSWORD);
    expect(a.hash).not.toBe(b.hash);
  });

  it('올바른 비밀번호를 검증한다', async () => {
    const hasher = new Argon2PasswordHasher();
    const credential = await hasher.hash(PASSWORD);
    await expect(hasher.verify(credential, PASSWORD)).resolves.toBe(true);
  });

  it('틀린 비밀번호를 거절한다', async () => {
    const hasher = new Argon2PasswordHasher();
    const credential = await hasher.hash(PASSWORD);
    await expect(hasher.verify(credential, OTHER)).resolves.toBe(false);
  });

  it('망가진 해시로 검증하면 던지지 않고 false를 낸다', async () => {
    // 저장된 해시가 잘린 경우. 던지면 로그인 시도가 500이 되고, 그 계정은 영구히
    // 로그인 불가 상태로 보인다. false를 내면 평범한 인증 실패로 처리되어
    // 사용자가 비밀번호 재설정 흐름으로 갈 수 있다.
    const hasher = new Argon2PasswordHasher();
    await expect(hasher.verify(Credential.fromHash('not-a-hash'), PASSWORD)).resolves.toBe(false);
  });

  it('무관한 오류는 삼키지 않고 그대로 전파한다', async () => {
    // catch가 감싸는 범위는 @node-rs/argon2의 verify(...) 호출 하나뿐이어야 한다.
    // credential.hash나 password.reveal() 자체가 던지는 건 망가진 해시가 아니라
    // 코드 버그이고, 여기서도 false로 뭉개면 "왜 이 사용자는 로그인이 안 되는가"를
    // 조사할 단서가 사라진다.
    const hasher = new Argon2PasswordHasher();
    const credential = await hasher.hash(PASSWORD);
    const brokenPassword = {
      reveal(): string {
        throw new Error('예상치 못한 오류');
      },
    } as unknown as PlainPassword;

    await expect(hasher.verify(credential, brokenPassword)).rejects.toThrow('예상치 못한 오류');
  });
});
