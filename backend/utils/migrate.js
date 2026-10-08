require("dotenv").config();
const db = require("./db");

async function run() {
  const versions = await db.migrate();
  console.log(`[db] Migrations complete (${versions.join(", ") || "none pending"}).`);
}

run()
  .catch((error) => {
    console.error(`[db] Migration command failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.close();
    } catch (error) {
      console.error(`[db] Could not close the database cleanly: ${error.code || error.name}`);
      process.exitCode = 1;
    }
  });
