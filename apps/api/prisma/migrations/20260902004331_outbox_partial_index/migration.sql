-- 미발행 이벤트만 담는 부분 인덱스.
-- 릴레이는 published_at IS NULL 인 행만 훑으므로, 발행 완료된 행은 인덱스에서 빠진다.
CREATE INDEX "outbox_unpublished_idx"
  ON "outbox" ("occurred_at")
  WHERE "published_at" IS NULL;
