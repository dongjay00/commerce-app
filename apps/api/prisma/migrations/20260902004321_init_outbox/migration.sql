-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);
