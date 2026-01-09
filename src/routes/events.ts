import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Event, Channel, User, Participation } from '../models'
import { getLeaderboard, getUserPosition, getParticipantsCount, finalizeEvent } from '../services/scoring'
import { verifyChannelAdmin, verifyBotAdmin, getChannelInfo, sendEventPost } from '../services/telegram'

interface CreateEventBody {
  channelId: number
  duration: '24h' | '48h' | '72h' | '7d'
  activityType: 'reactions' | 'comments' | 'all'
  winnersCount: number
}

export async function eventRoutes(fastify: FastifyInstance) {
  // Get user's events
  fastify.get('/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const events = await Event.find({ ownerId: Number(telegramId) })
      .sort({ createdAt: -1 })
      .lean()

    return { events }
  })

  // Get single event
  fastify.get('/events/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const event = await Event.findById(request.params.id).lean()
    if (!event) {
      return reply.status(404).send({ error: 'Event not found' })
    }

    const participantsCount = await getParticipantsCount(event._id)

    return {
      event: {
        ...event,
        participantsCount,
      },
    }
  })

  // Create event
  fastify.post('/events', async (request: FastifyRequest<{ Body: CreateEventBody }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const { channelId, duration, activityType, winnersCount } = request.body

    // Verify user is channel admin
    const isAdmin = await verifyChannelAdmin(channelId, Number(telegramId))
    if (!isAdmin) {
      return reply.status(403).send({ error: 'You must be an admin of this channel' })
    }

    // Verify bot is admin in channel
    const botIsAdmin = await verifyBotAdmin(channelId)
    if (!botIsAdmin) {
      return reply.status(400).send({ error: 'Please add @UnicBot as admin to your channel first' })
    }

    // Check user's plan limits
    const user = await User.findOne({ telegramId: Number(telegramId) })
    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }

    // Check event limits based on plan
    const limits: Record<string, number> = {
      free: 1,
      trial: 3,
      basic: 10,
      advanced: -1, // unlimited
      premium: -1,
    }
    const limit = limits[user.plan]
    if (limit !== -1 && user.eventsThisMonth >= limit) {
      return reply.status(403).send({ error: 'Event limit reached. Upgrade your plan.' })
    }

    // Create event
    const event = new Event({
      channelId,
      ownerId: Number(telegramId),
      duration,
      activityType,
      winnersCount,
      status: 'pending_payment',
    })

    await event.save()

    // Update user stats
    await User.findByIdAndUpdate(user._id, {
      $inc: { eventsCreated: 1, eventsThisMonth: 1 },
    })

    return { event }
  })

  // Activate event (after payment)
  fastify.post('/events/:id/activate', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const event = await Event.findById(request.params.id)
    if (!event) {
      return reply.status(404).send({ error: 'Event not found' })
    }

    if (event.ownerId !== Number(telegramId)) {
      return reply.status(403).send({ error: 'Not your event' })
    }

    // Calculate end time
    const durationMs: Record<string, number> = {
      '24h': 24 * 60 * 60 * 1000,
      '48h': 48 * 60 * 60 * 1000,
      '72h': 72 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    }

    const now = new Date()
    event.status = 'active'
    event.startsAt = now
    event.endsAt = new Date(now.getTime() + durationMs[event.duration])

    await event.save()

    // Send post to channel
    const webAppUrl = process.env.FRONTEND_URL || 'https://unic.app'
    const messageId = await sendEventPost(
      event.channelId,
      event._id.toString(),
      event.winnersCount,
      event.duration,
      webAppUrl
    )

    event.postMessageId = messageId
    await event.save()

    return { event }
  })

  // Get event leaderboard
  fastify.get('/events/:id/leaderboard', async (
    request: FastifyRequest<{
      Params: { id: string }
      Querystring: { limit?: string; offset?: string }
    }>,
    reply: FastifyReply
  ) => {
    const { id } = request.params
    const limit = parseInt(request.query.limit || '50')
    const offset = parseInt(request.query.offset || '0')

    const event = await Event.findById(id).lean()
    if (!event) {
      return reply.status(404).send({ error: 'Event not found' })
    }

    const leaderboard = await getLeaderboard(id, limit, offset)
    const totalParticipants = await getParticipantsCount(id)

    return {
      event: {
        _id: event._id,
        channelId: event.channelId,
        status: event.status,
        winnersCount: event.winnersCount,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        totalReactions: event.totalReactions,
        totalComments: event.totalComments,
      },
      leaderboard,
      totalParticipants,
    }
  })

  // Get user's position in event
  fastify.get('/events/:id/position', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const position = await getUserPosition(request.params.id, Number(telegramId))
    if (!position) {
      return { position: null, message: 'Not participating yet' }
    }

    return { position }
  })

  // Complete event manually
  fastify.post('/events/:id/complete', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const event = await Event.findById(request.params.id)
    if (!event) {
      return reply.status(404).send({ error: 'Event not found' })
    }

    if (event.ownerId !== Number(telegramId)) {
      return reply.status(403).send({ error: 'Not your event' })
    }

    if (event.status !== 'active') {
      return reply.status(400).send({ error: 'Event is not active' })
    }

    await finalizeEvent(event._id)

    const updatedEvent = await Event.findById(event._id).lean()

    return { event: updatedEvent }
  })
}
