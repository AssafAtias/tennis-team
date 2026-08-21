import { sql } from 'kysely'
import type { FastifyInstance } from 'fastify'
import type { Deps } from '../app.js'

export async function healthRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/health', async () => {
    await sql`select 1`.execute(deps.db)
    return { status: 'ok' }
  })
}
