-- Administrador principal (dono do CRM): ninguém pode tirar o papel de administrador dele.
ALTER TABLE "User" ADD COLUMN "isOwner" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "isOwner" = true, "role" = 'ADMIN' WHERE lower("email") = 'cristianleite200516@gmail.com';
