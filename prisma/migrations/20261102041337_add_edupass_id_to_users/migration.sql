/*
  Warnings:

  - A unique constraint covering the columns `[edupass_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "edupass_id" TEXT,
ALTER COLUMN "google_provider_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_edupass_id_key" ON "users"("edupass_id");
