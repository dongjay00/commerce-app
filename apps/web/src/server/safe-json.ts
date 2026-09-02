/**
 * 응답 본문을 JSON으로 파싱한다. 프록시가 돌려주는 HTML 502처럼 계약과 무관한
 * 비-JSON 응답이 올 수 있다 — 그런 경우 예외를 던지는 대신 `null`을 돌려줘서
 * 호출자가 "계약과 다른 응답" 경로(스키마 파싱 실패와 동일한 경로)로 처리하게 한다.
 */
export async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
