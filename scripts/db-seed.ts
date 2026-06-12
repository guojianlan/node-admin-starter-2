import { sqlite } from "../src/server/db";
import { seedDatabase } from "../src/server/db/seed/seed";

await seedDatabase(sqlite);
console.log("Database seeded. Default account: admin / 123456");
