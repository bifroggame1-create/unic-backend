import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { User, Event } from '../models'
import { isValidTelegramId, sanitizeString } from '../utils/validation'
import { GiftPoolService } from '../services/giftPool'
import { PrizeService } from '../services/prize'

// Middleware to check if user is admin
async function checkAdmin(request: FastifyRequest, reply: FastifyReply) {
  const telegramId = request.headers['x-telegram-id']
  if (!telegramId) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }

  const userId = Number(telegramId)
  if (!isValidTelegramId(userId)) {
    return reply.status(401).send({ error: 'Invalid Telegram ID' })
  }

  const user = await User.findOne({ telegramId: userId })
  if (!user || !user.isAdmin) {
    return reply.status(403).send({ error: 'Access denied: Admin only' })
  }

  return true
}

export async function adminRoutes(fastify: FastifyInstance) {
  // Complete event manually
  fastify.post('/admin/events/:id/complete', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    // Check admin
    const adminCheck = await checkAdmin(request, reply)
    if (adminCheck !== true) return adminCheck

    const { id } = request.params

    try {
      const event = await Event.findById(id)
      if (!event) {
        return reply.status(404).send({ error: 'Event not found' })
      }

      if (event.status !== 'active') {
        return reply.status(400).send({ error: 'Event is not active' })
      }

      // Import SchedulerService dynamically
      const { SchedulerService } = await import('../services/scheduler')
      await SchedulerService.completeEventManually(id)

      const updatedEvent = await Event.findById(id).lean()

      console.log(`✅ Admin manually completed event ${id}`)
      return { success: true, event: updatedEvent, message: 'Event completed and gifts sent' }
    } catch (error: any) {
      console.error('Error completing event:', error)
      return reply.status(500).send({ error: error.message || 'Failed to complete event' })
    }
  })

  // Grant subscription to user by username
  fastify.post('/admin/users/grant-plan', async (request: FastifyRequest<{
    Body: { username: string; planId: string }
  }>, reply: FastifyReply) => {
    // Check admin
    const adminCheck = await checkAdmin(request, reply)
    if (adminCheck !== true) return adminCheck

    const { username, planId } = request.body

    // Validate input
    if (!username || typeof username !== 'string') {
      return reply.status(400).send({ error: 'Username is required' })
    }

    if (!planId || !['trial', 'basic', 'advanced', 'premium'].includes(planId)) {
      return reply.status(400).send({ error: 'Invalid plan ID' })
    }

    const sanitizedUsername = sanitizeString(username.replace('@', ''))

    try {
      // Find user by username
      const user = await User.findOne({ username: sanitizedUsername })
      if (!user) {
        return reply.status(404).send({ error: `User @${sanitizedUsername} not found` })
      }

      // Set plan duration (30 days for all plans)
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 30)

      // Update user plan
      user.plan = planId as 'trial' | 'basic' | 'advanced' | 'premium'
      user.planExpiresAt = expiresAt
      await user.save()

      console.log(`✅ Admin granted ${planId} plan to @${sanitizedUsername}`)
      return {
        success: true,
        message: `Successfully granted ${planId} plan to @${sanitizedUsername}`,
        user: {
          username: user.username,
          plan: user.plan,
          planExpiresAt: user.planExpiresAt,
        },
      }
    } catch (error: any) {
      console.error('Error granting plan:', error)
      return reply.status(500).send({ error: error.message || 'Failed to grant plan' })
    }
  })

  // Get all users (admin only)
  fastify.get('/admin/users', async (request: FastifyRequest, reply: FastifyReply) => {
    // Check admin
    const adminCheck = await checkAdmin(request, reply)
    if (adminCheck !== true) return adminCheck

    try {
      const users = await User.find()
        .select('telegramId username firstName lastName plan planExpiresAt eventsCreated referralsCount isAdmin userRole')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()

      return { users }
    } catch (error: any) {
      return reply.status(500).send({ error: 'Failed to fetch users' })
    }
  })

  // Get all events (admin only)
  fastify.get('/admin/events', async (request: FastifyRequest, reply: FastifyReply) => {
    // Check admin
    const adminCheck = await checkAdmin(request, reply)
    if (adminCheck !== true) return adminCheck

    try {
      const events = await Event.find()
        .select('_id channelId ownerId status duration winnersCount startsAt endsAt participantsCount')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()

      return { events }
    } catch (error: any) {
      return reply.status(500).send({ error: 'Failed to fetch events' })
    }
  })

  // ========== Gift Pool Management Routes ==========

  // Get gift pool stats and all gifts
  fastify.get('/admin/gift-pool', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminCheck = await checkAdmin(request, reply)
    if (adminCheck !== true) return adminCheck

    try {
      const [gifts, stats] = await Promise.all([
        GiftPoolService.getAllPoolGifts(),
        GiftPoolService.getPoolStats()
      ])

      return { gifts, stats }
    } catch (error: any) {
      console.error('Error fetching gift pool:', error)
      return reply.status(500).send({ error: error.message || 'Failed to fetch gift pool' })
    }
  })

  // Add gifts to pool
  fastify.post('/admin/gift-pool/add', async (request: FastifyRequest<{
    Body: { giftId: string; quantity: number }
  }>, reply: FastifyReply) => {
    const adminCheck = await checkAdmin(request, reply)
    if (adminCheck !== true) return adminCheck

    const { giftId, quantity } = request.body

    // Validate input
    if (!giftId || typeof giftId !== 'string') {
      return reply.status(400).send({ error: 'Gift ID is required' })
    }

    if (!quantity || typeof quantity !== 'number' || quantity <= 0) {
      return reply.status(400).send({ error: 'Quantity must be a positive number' })
    }

    try {
      const gift = await GiftPoolService.addToPool(giftId, quantity)

      console.log(`✅ Admin added ${quantity} of gift ${giftId} to pool`)
      return {
        success: true,
        message: `Added ${quantity} gifts to pool`,
        gift
      }
    } catch (error: any) {
      console.error('Error adding gift to pool:', error)
      return reply.status(500).send({ error: error.message || 'Failed to add gift to pool' })
    }
  })

  // Sync gifts from Telegram API
  fastify.post('/admin/gift-pool/sync', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminCheck = await checkAdmin(request, reply)
    if (adminCheck !== true) return adminCheck

    try {
      await GiftPoolService.syncGiftsFromTelegram()

      console.log('✅ Admin synced gifts from Telegram')
      return {
        success: true,
        message: 'Successfully synced gifts from Telegram API'
      }
    } catch (error: any) {
      console.error('Error syncing gifts:', error)
      return reply.status(500).send({ error: error.message || 'Failed to sync gifts' })
    }
  })

  // ========== Prize Distribution Management Routes ==========

  // Get failed prize distributions
  fastify.get('/admin/prizes/failed', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminCheck = await checkAdmin(request, reply)
    if (adminCheck !== true) return adminCheck

    try {
      const failedPrizes = await PrizeService.getFailedPrizes()

      return { prizes: failedPrizes }
    } catch (error: any) {
      console.error('Error fetching failed prizes:', error)
      return reply.status(500).send({ error: error.message || 'Failed to fetch failed prizes' })
    }
  })

  // Retry failed prize distribution
  fastify.post('/admin/prizes/:id/retry', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const adminCheck = await checkAdmin(request, reply)
    if (adminCheck !== true) return adminCheck

    const { id } = request.params

    try {
      const success = await PrizeService.retryFailedPrize(id)

      if (success) {
        console.log(`✅ Admin retried prize distribution ${id}`)
        return {
          success: true,
          message: 'Prize distribution retried successfully'
        }
      } else {
        return reply.status(400).send({ error: 'Failed to retry prize (max attempts reached or already sent)' })
      }
    } catch (error: any) {
      console.error('Error retrying prize:', error)
      return reply.status(500).send({ error: error.message || 'Failed to retry prize' })
    }
  })
}
