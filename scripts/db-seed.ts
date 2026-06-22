import "../src/server/load-dotenv";
import { closeDb } from "../src/server/db";
import { seedDatabase } from "../src/server/db/seed/seed";

await seedDatabase();
await closeDb();
console.log("Database seeded. Default account: admin / 123456");
