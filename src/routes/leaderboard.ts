import { FastifyInstance } from 'fastify'
import { Event, UserEventStats, User } from '../models'
import { PointsService } from '../services/points'
import { PaymentService } from '../services/payment'
import { Types } from 'mongoose'
import { validateEventId, validateUserId, isValidTelegramId, isValidBoostType, validatePagination, isValidObjectId } from '../utils/validation'

export async function leaderboardRoutes(fastify: FastifyInstance) {
  // Get event details for user view
  fastify.get('/events/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { userId } = request.query as { userId?: string }

    // Validate event ID
    const validation = validateEventId(id)
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }

    try {
      const event = await Event.findById(id)

      if (!event) {
        return reply.status(404).send({ error: 'Event not found' })
      }

      // Get top 10 for preview
      const topTen = await PointsService.calculateLeaderboard(id, 10, 0)

      // Enrich with user data
      const enrichedTopTen = await Promise.all(
        topTen.map(async (entry) => {
          const user = await User.findOne({ telegramId: entry.userId })
          return {
            ...entry,
            username: user?.username,
            firstName: user?.firstName,
          }
        })
      )

      // Get user position if userId provided
      let userPosition = null
      if (userId) {
        userPosition = await PointsService.getUserPosition(
          parseInt(userId),
          id
        )
      }

      // Calculate time remaining
      const now = new Date()
      const endsAt = event.endsAt
      let timeRemaining = null

      if (endsAt && event.status === 'active') {
        const diff = endsAt.getTime() - now.getTime()
        if (diff > 0) {
          const hours = Math.floor(diff / (1000 * 60 * 60))
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
          timeRemaining = { hours, minutes, totalMs: diff }
        }
      }

      return reply.send({
        event: {
          id: event._id,
          title: event.title,
          status: event.status,
          duration: event.duration,
          activityType: event.activityType,
          winnersCount: event.winnersCount,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          participantsCount: event.participantsCount,
          totalReactions: event.totalReactions,
          totalComments: event.totalComments,
          prizes: event.prizes,
          boostsEnabled: event.boostsEnabled,
          timeRemaining,
        },
        topTen: enrichedTopTen,
        userPosition,
      })
    } catch (error) {
      console.error('Error fetching event:', error)
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // Get full leaderboard with pagination
  fastify.get('/events/:id/leaderboard', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { limit = '50', offset = '0' } = request.query as {
      limit?: string
      offset?: string
    }

    // Validate event ID
    const validation = validateEventId(id)
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }

    // Validate and sanitize pagination
    const { limit: validLimit, offset: validOffset } = validatePagination(limit, offset)

    try {
      const event = await Event.findById(id)

      if (!event) {
        return reply.status(404).send({ error: 'Event not found' })
      }

      const leaderboard = await PointsService.calculateLeaderboard(
        id,
        validLimit,
        validOffset
      )

      // Enrich with user data
      const enriched = await Promise.all(
        leaderboard.map(async (entry) => {
          const user = await User.findOne({ telegramId: entry.userId })
          return {
            rank: entry.rank,
            userId: entry.userId,
            username: user?.username,
            firstName: user?.firstName,
            points: entry.points,
            reactionsCount: entry.reactionsCount,
            commentsCount: entry.commentsCount,
            repliesCount: entry.repliesCount,
            boostMultiplier: entry.boostMultiplier,
            lastActivityAt: entry.lastActivityAt,
          }
        })
      )

      // Get total count for pagination
      const totalParticipants = await UserEventStats.countDocuments({
        eventId: new Types.ObjectId(id),
      })

      return reply.send({
        leaderboard: enriched,
        pagination: {
          total: totalParticipants,
          limit: validLimit,
          offset: validOffset,
          hasMore: validOffset + enriched.length < totalParticipants,
        },
      })
    } catch (error) {
      console.error('Error fetching leaderboard:', error)
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // Get user's current position and stats
  fastify.get('/events/:id/position', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { userId } = request.query as { userId: string }

    // Validate event ID
    const validation = validateEventId(id)
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }

    // Validate user ID
    const validUserId = validateUserId(userId)
    if (!validUserId) {
      return reply.status(400).send({ error: 'Invalid userId format' })
    }

    try {
      const event = await Event.findById(id)

      if (!event) {
        return reply.status(404).send({ error: 'Event not found' })
      }

      const position = await PointsService.getUserPosition(
        validUserId,
        id
      )

      if (!position) {
        return reply.send({
          participating: false,
          message: 'User has not participated in this event yet',
        })
      }

      // Get detailed user stats
      const stats = await UserEventStats.findOne({
        userId: validUserId,
        eventId: new Types.ObjectId(id),
      })

      return reply.send({
        participating: true,
        rank: position.rank,
        points: position.points,
        totalParticipants: position.totalParticipants,
        stats: {
          reactionsCount: stats?.reactionsCount || 0,
          commentsCount: stats?.commentsCount || 0,
          repliesCount: stats?.repliesCount || 0,
          boostMultiplier: stats?.boostMultiplier || 1.0,
          boostExpiresAt: stats?.boostExpiresAt,
          lastActivityAt: stats?.lastActivityAt,
        },
        isWinning: position.rank <= event.winnersCount,
        prizePosition:
          position.rank <= event.winnersCount ? position.rank : null,
      })
    } catch (error) {
      console.error('Error fetching user position:', error)
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // Create boost purchase invoice
  fastify.post('/events/:id/boost/invoice', async (request, reply) => {
    const { id } = request.params as { id: string }
    const {
      userId,
      boostType,
    } = request.body as {
      userId: number
      boostType: 'x2_24h' | 'x1.5_forever'
    }

    // Validate event ID
    const validation = validateEventId(id)
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }

    // Validate user ID
    if (!userId || !isValidTelegramId(userId)) {
      return reply.status(400).send({ error: 'Invalid userId' })
    }

    // Validate boost type
    if (!boostType || !isValidBoostType(boostType)) {
      return reply.status(400).send({
        error: 'boostType must be x2_24h or x1.5_forever',
      })
    }

    try {
      const event = await Event.findById(id)

      if (!event) {
        return reply.status(404).send({ error: 'Event not found' })
      }

      if (event.status !== 'active') {
        return reply.status(400).send({ error: 'Event is not active' })
      }

      if (!event.boostsEnabled) {
        return reply.status(400).send({
          error: 'Boosts are not enabled for this event',
        })
      }

      // Create Telegram Stars invoice
      const { invoiceLink, paymentId } = await PaymentService.createBoostInvoice(
        userId,
        id,
        boostType
      )

      return reply.send({
        invoiceLink,
        paymentId,
        amount: boostType === 'x2_24h' ? 100 : 200,
      })
    } catch (error: any) {
      console.error('Error creating boost invoice:', error)
      return reply.status(500).send({ error: 'Failed to create invoice' })
    }
  })

  // Apply boost after successful payment
  fastify.post('/events/:id/boost/apply', async (request, reply) => {
    const { id } = request.params as { id: string }
    const {
      userId,
      paymentId,
    } = request.body as {
      userId: number
      paymentId: string
    }

    // Validate event ID
    const validation = validateEventId(id)
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }

    // Validate user ID
    if (!userId || !isValidTelegramId(userId)) {
      return reply.status(400).send({ error: 'Invalid userId' })
    }

    // Validate payment ID
    if (!paymentId || !isValidObjectId(paymentId)) {
      return reply.status(400).send({ error: 'Invalid paymentId' })
    }

    try {
      // Verify payment was successful
      const payment = await PaymentService.getPayment(paymentId)

      if (!payment) {
        return reply.status(404).send({ error: 'Payment not found' })
      }

      if (payment.status !== 'success') {
        return reply.status(400).send({ error: 'Payment not completed' })
      }

      if (payment.userId !== userId) {
        return reply.status(403).send({ error: 'Unauthorized' })
      }

      const boostType = payment.metadata?.boostType as 'x2_24h' | 'x1.5_forever'

      if (!boostType) {
        return reply.status(400).send({ error: 'Invalid payment metadata' })
      }

      // Apply boost via PointsService
      await PointsService.applyBoost(userId, id, boostType, payment.amount)

      // Get updated user position
      const position = await PointsService.getUserPosition(userId, id)

      return reply.send({
        success: true,
        message: 'Boost activated successfully',
        boost: {
          type: boostType,
          multiplier: boostType === 'x2_24h' ? 2.0 : 1.5,
          expiresAt:
            boostType === 'x2_24h'
              ? new Date(Date.now() + 24 * 60 * 60 * 1000)
              : undefined,
        },
        userPosition: position,
      })
    } catch (error: any) {
      console.error('Error applying boost:', error)

      if (error.message === 'User already has an active boost') {
        return reply.status(400).send({ error: error.message })
      }

      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // Get user's activity timeline for "My Progress" screen
  fastify.get('/events/:id/timeline', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { userId } = request.query as { userId: string }

    // Validate event ID
    const validation = validateEventId(id)
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }

    // Validate user ID
    const validUserId = validateUserId(userId)
    if (!validUserId) {
      return reply.status(400).send({ error: 'Invalid userId format' })
    }

    try {
      const event = await Event.findById(id)

      if (!event) {
        return reply.status(404).send({ error: 'Event not found' })
      }

      const stats = await UserEventStats.findOne({
        userId: validUserId,
        eventId: new Types.ObjectId(id),
      })

      if (!stats) {
        return reply.send({
          timeline: [],
          message: 'No activity yet',
        })
      }

      // For MVP, return aggregated stats
      // In future, can track individual activities
      const timeline = [
        {
          type: 'reactions',
          count: stats.reactionsCount,
          points: stats.reactionsCount * 1 * stats.boostMultiplier,
        },
        {
          type: 'comments',
          count: stats.commentsCount,
          points: stats.commentsCount * 3 * stats.boostMultiplier,
        },
        {
          type: 'replies',
          count: stats.repliesCount,
          points: stats.repliesCount * 2 * stats.boostMultiplier,
        },
      ]

      return reply.send({
        timeline,
        totalPoints: stats.points,
        boostMultiplier: stats.boostMultiplier,
        boostExpiresAt: stats.boostExpiresAt,
        lastActivityAt: stats.lastActivityAt,
      })
    } catch (error) {
      console.error('Error fetching timeline:', error)
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })
}
