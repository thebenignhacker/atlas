import readline from "node:readline";
import { hashPassword } from "@/lib/owner-auth/password";

/**
 * Generate an OWNER_PASSWORD_HASH for the owner deployment. The password is read
 * from stdin (or passed as an arg) and NEVER printed — only the hash is. Set the
 * printed value as the OWNER_PASSWORD_HASH env var on the owner Vercel project.
 *
 *   echo -n 'your-strong-password' | npm run hash-password
 *   # or interactively:
 *   npm run hash-password        (then type the password and press Enter)
 */
function emit(password: string): void {
  const pw = password.trim();
  if (!pw) {
    console.error("atlas: empty password — nothing to hash.");
    process.exit(1);
  }
  if (pw.length < 12) {
    console.error(
      `atlas: WARNING — password is ${pw.length} chars. Use 16+ (the hash is the only brute-force barrier).`
    );
  }
  console.log(`OWNER_PASSWORD_HASH=${hashPassword(pw)}`);
}

const arg = process.argv[2];
if (arg) {
  emit(arg);
} else {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    emit(line);
    rl.close();
  });
}
