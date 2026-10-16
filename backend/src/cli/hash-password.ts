// Prints a password hash for the BURNING_PASSWORD_FILE accounts file.
// The password is read from standard input, so it stays out of shell history:
//
//   pnpm --filter backend hash-password
//   echo -n 'secret' | pnpm --filter backend hash-password
import { createInterface } from "node:readline";
import { hashPassword } from "../passwords.js";

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
if (process.stdin.isTTY) process.stderr.write("Password: ");
rl.once("line", (line) => {
  rl.close();
  if (!line) {
    console.error("empty password");
    process.exit(1);
  }
  if (process.stdin.isTTY) process.stderr.write("\n");
  console.log(hashPassword(line));
});
