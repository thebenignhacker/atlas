import { getDb, initSchema } from "@/lib/db";

initSchema(getDb());
console.log("atlas: schema initialized at data/atlas.db");
