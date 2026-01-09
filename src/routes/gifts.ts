import { FastifyInstance } from 'fastify'
import { GiftsService } from '../services/gifts'

export async function giftsRoutes(fastify: FastifyInstance) {
  // Get available Telegram gifts
  fastify.get('/gifts', async (request, reply) => {
    try {
      const gifts = await GiftsService.getAvailableGifts()

      return reply.send({
        gifts,
      })
    } catch (error) {
      console.error('Error fetching gifts:', error)
      return reply.status(500).send({ error: 'Failed to fetch gifts' })
    }
  })
}
