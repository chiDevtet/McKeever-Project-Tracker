import path from "node:path";
import { config } from "dotenv";

// Point every server module at the disposable test database and storage.
config({ quiet: true });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_ENV = "test";
process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_DIR = path.resolve(".data/test-storage");
process.env.MAIL_TRANSPORT = "outbox";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";
