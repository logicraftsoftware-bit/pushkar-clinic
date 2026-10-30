import { config } from './config.js'
import { pool } from './db.js'
import app from './app.js'

const server = app.listen(config.API_PORT, () => {
  console.log(`Careframe API listening on http://localhost:${config.API_PORT}`)
})

async function shutdown() {
  server.close()
  await pool.end()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
