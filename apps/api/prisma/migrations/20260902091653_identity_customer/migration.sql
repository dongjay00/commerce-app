-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "rotated_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_addresses" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "saved_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_account_id_idx" ON "sessions"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_account_id_key" ON "customers"("account_id");

-- CreateIndex
CREATE INDEX "saved_addresses_customer_id_idx" ON "saved_addresses"("customer_id");

-- AddForeignKey
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 기본 배송지는 고객당 0개 또는 1개.
-- 부분 유니크 인덱스라서 is_default=false 인 행은 몇 개든 허용된다.
-- Prisma 스키마 언어로는 표현할 수 없어 여기에만 존재한다 —
-- apps/api/test/schema/indexes.integration.spec.ts가 소실을 감시한다.
CREATE UNIQUE INDEX "saved_addresses_default_idx"
  ON "saved_addresses" ("customer_id")
  WHERE "is_default";
