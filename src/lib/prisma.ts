import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { readFileOperationConfig } from './files/config';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
  connectionTimeoutMillis: readFileOperationConfig().databaseTimeoutMs,
  statement_timeout: readFileOperationConfig().databaseTimeoutMs,
  idle_in_transaction_session_timeout: readFileOperationConfig().databaseTimeoutMs * 2,
});

export const prisma = new PrismaClient({ adapter });
