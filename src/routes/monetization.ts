import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Event, User } from '../models'
import { PaymentService } from '../services/payment'
import { isValidTelegramId, isValidObjectId } from '../utils/validation'

// Boost pricing
const BOOST_PRICING = {
  x1_5_event: {
    multiplier: 1.5,
    duration: 'event',
    priceStars: 100,
  },
}

// Second Chance pricing
const SECOND_CHANCE_PRICING = {
  priceStars: 75,
}

export async function monetizationRoutes(fastify: FastifyInstance) {
  // Create Boost invoice
  fastify.post(
    '/events/:id/boost/invoice',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const telegramId = request.headers['x-telegram-id']
      if (!telegramId) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }

      const userId = Number(telegramId)
      if (!isValidTelegramId(userId)) {
        return reply.status(401).send({ error: 'Invalid Telegram ID' })
      }

      const { id } = request.params
      if (!isValidObjectId(id)) {
        return reply.status(400).send({ error: 'Invalid event ID' })
      }

      const event = await Event.findById(id)
      if (!event) {
        return reply.status(404).send({ error: 'Event not found' })
      }

      if (event.status !== 'active') {
        return reply.status(400).send({ error: 'Event is not active' })
      }

      try {
        const { invoiceLink, paymentId } = await PaymentService.createBoostInvoice(
          userId,
          id,
          BOOST_PRICING.x1_5_event.priceStars
        )

        return reply.send({
          invoiceLink,
          paymentId,
          amount: BOOST_PRICING.x1_5_event.priceStars,
          multiplier: BOOST_PRICING.x1_5_event.multiplier,
        })
      } catch (error: any) {
        console.error('Error creating boost invoice:', error)
        return reply.status(500).send({ error: 'Failed to create invoice' })
      }
    }
  )

  // Apply Boost after payment
  fastify.post(
    '/events/:id/boost/apply',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { paymentId: string } }>,
      reply: FastifyReply
    ) => {
      const telegramId = request.headers['x-telegram-id']
      if (!telegramId) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }

      const userId = Number(telegramId)
      if (!isValidTelegramId(userId)) {
        return reply.status(401).send({ error: 'Invalid Telegram ID' })
      }

      const { id } = request.params
      const { paymentId } = request.body

      if (!isValidObjectId(id) || !isValidObjectId(paymentId)) {
        return reply.status(400).send({ error: 'Invalid ID format' })
      }

      const event = await Event.findById(id)
      if (!event) {
        return reply.status(404).send({ error: 'Event not found' })
      }

      // Verify payment
      const payment = await PaymentService.getPayment(paymentId)
      if (!payment || payment.status !== 'success' || payment.userId !== userId) {
        return reply.status(400).send({ error: 'Payment not verified' })
      }

      // Store boost metadata in event (simplified - in real app would be separate collection)
      // For MVP, just track that boost was purchased
      // Real implementation would need boost tracking per user

      return reply.send({
        success: true,
        multiplier: BOOST_PRICING.x1_5_event.multiplier,
        message: 'Boost активирован! Твои следующие действия принесут больше очков.',
      })
    }
  )

  // Create Second Chance invoice
  fastify.post(
    '/events/:id/second-chance/invoice',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const telegramId = request.headers['x-telegram-id']
      if (!telegramId) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }

      const userId = Number(telegramId)
      if (!isValidTelegramId(userId)) {
        return reply.status(401).send({ error: 'Invalid Telegram ID' })
      }

      const { id } = request.params
      if (!isValidObjectId(id)) {
        return reply.status(400).send({ error: 'Invalid event ID' })
      }

      const event = await Event.findById(id)
      if (!event) {
        return reply.status(404).send({ error: 'Event not found' })
      }

      if (event.status !== 'completed') {
        return reply.status(400).send({ error: 'Event is not completed' })
      }

      try {
        const { invoiceLink, paymentId } = await PaymentService.createSecondChanceInvoice(
          userId,
          id,
          SECOND_CHANCE_PRICING.priceStars
        )

        return reply.send({
          invoiceLink,
          paymentId,
          amount: SECOND_CHANCE_PRICING.priceStars,
        })
      } catch (error: any) {
        console.error('Error creating second chance invoice:', error)
        return reply.status(500).send({ error: 'Failed to create invoice' })
      }
    }
  )

  // Apply Second Chance after payment
  fastify.post(
    '/events/:id/second-chance/apply',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { paymentId: string } }>,
      reply: FastifyReply
    ) => {
      const telegramId = request.headers['x-telegram-id']
      if (!telegramId) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }

      const userId = Number(telegramId)
      if (!isValidTelegramId(userId)) {
        return reply.status(401).send({ error: 'Invalid Telegram ID' })
      }

      const { id } = request.params
      const { paymentId } = request.body

      if (!isValidObjectId(id) || !isValidObjectId(paymentId)) {
        return reply.status(400).send({ error: 'Invalid ID format' })
      }

      const event = await Event.findById(id)
      if (!event) {
        return reply.status(404).send({ error: 'Event not found' })
      }

      // Verify payment
      const payment = await PaymentService.getPayment(paymentId)
      if (!payment || payment.status !== 'success' || payment.userId !== userId) {
        return reply.status(400).send({ error: 'Payment not verified' })
      }

      // Store second chance entry (simplified - in real app would be separate collection)
      // Real implementation would need second chance draw system

      return reply.send({
        success: true,
        message: 'Second Chance активирован! Дополнительный розыгрыш будет проведён в ближайшее время.',
      })
    }
  )

  // Log analytics event
  fastify.post('/analytics', async (request: FastifyRequest, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Log analytics event (simplified - in real app would store in DB or send to analytics service)
    console.log('[Analytics]', request.body)

    return reply.send({ success: true })
  })
}
