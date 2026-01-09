import { FastifyInstance } from 'fastify'
import { eventRoutes } from './events'
import { channelRoutes } from './channels'
import { userRoutes } from './users'
import { leaderboardRoutes } from './leaderboard'
import { giftsRoutes } from './gifts'

export async function registerRoutes(fastify: FastifyInstance) {
  // API prefix
  fastify.register(async (api) => {
    api.register(eventRoutes)
    api.register(channelRoutes)
    api.register(userRoutes)
    api.register(leaderboardRoutes)
    api.register(giftsRoutes)
  }, { prefix: '/api' })

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))
}
