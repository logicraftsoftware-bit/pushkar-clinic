import dotenv from "dotenv";
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

dotenv.config({
  path:
    process.env.ENV_FILE ??
    (path.basename(process.cwd()) === "server" ? "../.env" : ".env"),
});

export async function runMigrations() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const migrationsDirectory = path.resolve(
    process.cwd(),
    path.basename(process.cwd()) === "server"
      ? "../database/migrations"
      : "database/migrations",
  );
  const client = new pg.Client({
    connectionString:
      process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
  });
  await client.connect();
  try {
    await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const exists = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1",
        [filename],
      );
      if (exists.rowCount) continue;
      const sql = await readFile(
        path.join(migrationsDirectory, filename),
        "utf8",
      );
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename],
      );
    }
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runMigrations();
  console.log("Database migrations complete");
}
