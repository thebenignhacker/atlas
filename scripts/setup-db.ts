import { createDb, initSchema } from "@/lib/db";
import { dbPath } from "@/lib/paths";

// The single sanctioned creation point. Every other caller uses getDb(), which
// refuses to create — so a database only ever comes into existence here.
initSchema(createDb());
console.log(`atlas: schema initialized at ${dbPath()}`);
