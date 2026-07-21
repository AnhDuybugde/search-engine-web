import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
config({ path: path.join(root, ".env.local") });

// Use tsx loader programmatically
await import("tsx/esm");

const { ensureUsersTable, createUser, findUserByEmail } = await import(
  pathToFileURL(path.join(root, "src/lib/db/users-repo.ts")).href
);
const { hashPassword, verifyPassword } = await import(
  pathToFileURL(path.join(root, "src/lib/auth.ts")).href
);

const ok = await ensureUsersTable();
console.log("ensureUsersTable", ok);

const email = "test_123@gmail.com";
try {
  const u = await createUser({
    email,
    passwordHash: hashPassword("password123"),
    displayName: "Taxaceae",
  });
  console.log("created", u);
} catch (e) {
  console.log("create:", e.message);
}

const found = await findUserByEmail(email);
console.log({
  email: found?.email,
  displayName: found?.displayName,
  passwordOk: found ? verifyPassword("password123", found.passwordHash) : false,
  backend: ok ? "sql" : "other",
});
