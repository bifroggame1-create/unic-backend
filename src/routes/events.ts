import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Event, Channel, User, Participation } from '../models'
import { getLeaderboard, getUserPosition, getParticipantsCount, finalizeEvent } from '../services/scoring'
import { verifyChannelAdmin, verifyBotAdmin, getChannelInfo, sendEventPost } from '../services/telegram'
import { PaymentService } from '../services/payment'
import { validateEventId, isValidTelegramId, isValidDuration, isValidActivityType, isValidWinnersCount, validatePagination, sanitizeString, isValidObjectId } from '../utils/validation'

interface CreateEventBody {
  channelId: number
  duration: '24h' | '48h' | '72h' | '7d'
  activityType: 'reactions' | 'comments' | 'all'
  winnersCount: number
  prizes?: Array<{
    giftId: string
    name: string
    position: number
    value?: number
  }>
  packageId?: string
  title?: string
  boostsEnabled?: boolean
}

export async function eventRoutes(fastify: FastifyInstance) {
  // Get user's events
  fastify.get('/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Validate Telegram ID
    const userId = Number(telegramId)
    if (!isValidTelegramId(userId)) {
      return reply.status(401).send({ error: 'Invalid Telegram ID' })
    }

    const events = await Event.find({ ownerId: userId })
      .sort({ createdAt: -1 })
      .lean()

    return { events }
  })

  // Get single event
  fastify.get('/events/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params

    // Validate event ID
    const validation = validateEventId(id)
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }

    const event = await Event.findById(id).lean()
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

    // Validate Telegram ID
    const userId = Number(telegramId)
    if (!isValidTelegramId(userId)) {
      return reply.status(401).send({ error: 'Invalid Telegram ID' })
    }

    const { channelId, duration, activityType, winnersCount, prizes, packageId, title, boostsEnabled } = request.body

    // Validate required fields
    if (!channelId || !isValidTelegramId(channelId)) {
      return reply.status(400).send({ error: 'Invalid channelId' })
    }

    if (!duration || !isValidDuration(duration)) {
      return reply.status(400).send({ error: 'Invalid duration. Must be 24h, 48h, 72h, or 7d' })
    }

    if (!activityType || !isValidActivityType(activityType)) {
      return reply.status(400).send({ error: 'Invalid activityType. Must be reactions, comments, or all' })
    }

    if (!winnersCount || !isValidWinnersCount(winnersCount)) {
      return reply.status(400).send({ error: 'Invalid winnersCount. Must be between 1 and 100' })
    }

    // Sanitize optional title
    const sanitizedTitle = title ? sanitizeString(title) : undefined

    // Verify user is channel admin
    const isAdmin = await verifyChannelAdmin(channelId, userId)
    if (!isAdmin) {
      return reply.status(403).send({ error: 'You must be an admin of this channel' })
    }

    // Verify bot is admin in channel
    const botIsAdmin = await verifyBotAdmin(channelId)
    if (!botIsAdmin) {
      return reply.status(400).send({ error: 'Please add @UnicBot as admin to your channel first' })
    }

    // Check user's plan limits
    const user = await User.findOne({ telegramId: userId })
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
      ownerId: userId,
      title: sanitizedTitle,
      duration,
      activityType,
      winnersCount,
      prizes: prizes || [],
      packageId: packageId || 'free',
      boostsEnabled: boostsEnabled !== undefined ? boostsEnabled : true,
      status: packageId && packageId !== 'free' ? 'pending_payment' : 'draft',
    })

    await event.save()

    // Update user stats
    await User.findByIdAndUpdate(user._id, {
      $inc: { eventsCreated: 1, eventsThisMonth: 1 },
    })

    return { event }
  })

  // Create payment invoice for event package
  fastify.post('/events/:id/payment', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Validate Telegram ID
    const userId = Number(telegramId)
    if (!isValidTelegramId(userId)) {
      return reply.status(401).send({ error: 'Invalid Telegram ID' })
    }

    const { id } = request.params

    // Validate event ID
    const validation = validateEventId(id)
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }

    const event = await Event.findById(id)
    if (!event) {
      return reply.status(404).send({ error: 'Event not found' })
    }

    if (event.ownerId !== userId) {
      return reply.status(403).send({ error: 'Not your event' })
    }

    if (event.status !== 'pending_payment') {
      return reply.status(400).send({ error: 'Event is not pending payment' })
    }

    // Package pricing (in Stars)
    const packages: Record<string, { amount: number; name: string }> = {
      starter: { amount: 500, name: 'Starter Package' },
      growth: { amount: 2000, name: 'Growth Package' },
      pro: { amount: 5000, name: 'Pro Package' },
    }

    const pkg = packages[event.packageId || 'starter']
    if (!pkg) {
      return reply.status(400).send({ error: 'Invalid package' })
    }

    try {
      const { invoiceLink, paymentId } = await PaymentService.createEventPackageInvoice(
        userId,
        event._id,
        event.packageId || 'starter',
        pkg.amount
      )

      // Save payment ID to event
      event.paymentId = paymentId
      event.pricePaid = pkg.amount
      await event.save()

      return reply.send({
        invoiceLink,
        paymentId,
        amount: pkg.amount,
        packageName: pkg.name,
      })
    } catch (error: any) {
      console.error('Error creating payment invoice:', error)
      return reply.status(500).send({ error: 'Failed to create invoice' })
    }
  })

  // Activate event (after payment or for free events)
  fastify.post('/events/:id/activate', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Validate Telegram ID
    const userId = Number(telegramId)
    if (!isValidTelegramId(userId)) {
      return reply.status(401).send({ error: 'Invalid Telegram ID' })
    }

    const { id } = request.params

    // Validate event ID
    const validation = validateEventId(id)
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }

    const event = await Event.findById(id)
    if (!event) {
      return reply.status(404).send({ error: 'Event not found' })
    }

    if (event.ownerId !== userId) {
      return reply.status(403).send({ error: 'Not your event' })
    }

    // Verify payment for paid packages
    if (event.packageId && event.packageId !== 'free') {
      if (!event.paymentId) {
        return reply.status(400).send({ error: 'Payment not initiated' })
      }

      // Validate payment ID format
      if (!isValidObjectId(event.paymentId)) {
        return reply.status(400).send({ error: 'Invalid payment ID' })
      }

      const payment = await PaymentService.getPayment(event.paymentId)
      if (!payment || payment.status !== 'success') {
        return reply.status(400).send({ error: 'Payment not completed' })
      }
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

    // Validate event ID
    const validation = validateEventId(id)
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }

    // Validate and sanitize pagination
    const { limit, offset } = validatePagination(request.query.limit, request.query.offset)

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

    // Validate Telegram ID
    const userId = Number(telegramId)
    if (!isValidTelegramId(userId)) {
      return reply.status(401).send({ error: 'Invalid Telegram ID' })
    }

    const { id } = request.params

    // Validate event ID
    const validation = validateEventId(id)
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }

    const position = await getUserPosition(id, userId)
    if (!position) {
      return { position: null, message: 'Not participating yet' }
    }

    return { position }
  })

  // Complete event manually (admin action)
  fastify.post('/events/:id/complete', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Validate Telegram ID
    const userId = Number(telegramId)
    if (!isValidTelegramId(userId)) {
      return reply.status(401).send({ error: 'Invalid Telegram ID' })
    }

    const { id } = request.params

    // Validate event ID
    const validation = validateEventId(id)
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }

    const event = await Event.findById(id)
    if (!event) {
      return reply.status(404).send({ error: 'Event not found' })
    }

    if (event.ownerId !== userId) {
      return reply.status(403).send({ error: 'Not your event' })
    }

    if (event.status !== 'active') {
      return reply.status(400).send({ error: 'Event is not active' })
    }

    try {
      // Import SchedulerService dynamically to avoid circular deps
      const { SchedulerService } = await import('../services/scheduler')
      await SchedulerService.completeEventManually(id)

      const updatedEvent = await Event.findById(event._id).lean()

      return { event: updatedEvent, message: 'Event completed and gifts sent' }
    } catch (error: any) {
      console.error('Error completing event:', error)
      return reply.status(500).send({ error: error.message || 'Failed to complete event' })
    }
  })
}
