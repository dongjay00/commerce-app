// vitest 전용 대역. `server-only`는 Next 번들러가 클라이언트 번들에서 이 모듈을
// 만나면 throw하게 만드는 빌드 타임 트릭이라, 번들러가 아닌 vitest 안에서는 아무
// 의미가 없다 — 그래서 web 프로젝트에서만 빈 모듈로 치환한다. 실제 Next 빌드는
// 진짜 `server-only` 패키지를 그대로 쓴다 (apps/web/package.json 의존성 참고).
export {};
