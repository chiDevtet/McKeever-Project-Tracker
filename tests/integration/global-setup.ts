import { config } from "dotenv";
import { resetTestDatabase } from "../helpers/test-db";

/**
 * Integration tests run against a real, disposable PostgreSQL database named
 * by TEST_DATABASE_URL. It is wiped, migrated, and seeded before every run;
 * the development or production database is never touched.
 */
export default async function setup() {
  config({ quiet: true });
  await resetTestDatabase(".data/test-storage");
}
