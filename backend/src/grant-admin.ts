// Promote an existing account to system admin:
//   npm run admin:grant -w backend -- someone@example.com
// In Docker: docker compose run --rm api node backend/dist/grant-admin.js someone@example.com
import { pool } from "./db/pool.js";
import { audit } from "./lib/audit.js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: grant-admin <email>");
  process.exit(1);
}
const user = (
  await pool.query<{ id: string; role: string }>(
    "UPDATE users SET role='admin', disabled=false WHERE email=$1 RETURNING id, role",
    [email],
  )
).rows[0];
if (!user) {
  console.error(`No account uses ${email}`);
  await pool.end();
  process.exit(1);
}
await audit({
  actorId: null,
  action: "user.role_changed",
  targetType: "user",
  targetId: user.id,
  details: { email, to: "admin", via: "grant-admin" },
});
console.log(`${email} is now an admin.`);
await pool.end();
