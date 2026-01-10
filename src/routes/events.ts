import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Event, User, UserEventStats } from '../models'
import { verifyChannelAdmin, verifyBotAdmin, sendEventPost } from '../services/telegram'
import { PaymentService } from '../services/payment'
import { validateEventId, isValidTelegramId, isValidChannelId, isValidDuration, isValidActivityType, isValidWinnersCount, sanitizeString, isValidObjectId } from '../utils/validation'
import { sendError, ErrorMessages } from '../utils/errors'

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
  // Get all public active events (discovery feed)
  fastify.get('/events/public', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const events = await Event.find({
        status: 'active',
        endsAt: { $gt: new Date() }, // Only ongoing events
      })
        .select('_id channelId title duration activityType winnersCount startsAt endsAt participantsCount totalReactions totalComments prizes boostsEnabled')
        .sort({ participantsCount: -1, startsAt: -1 }) // Popular first, then newest
        .limit(50)
        .lean()

      // Calculate time remaining for each event
      const eventsWithTimeRemaining = events.map(event => {
        const now = new Date()
        const endsAt = event.endsAt
        let timeRemaining = null

        if (endsAt) {
          const diff = endsAt.getTime() - now.getTime()
          if (diff > 0) {
            const hours = Math.floor(diff / (1000 * 60 * 60))
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
            timeRemaining = { hours, minutes, totalMs: diff }
          }
        }

        return {
          ...event,
          timeRemaining,
        }
      })

      return { events: eventsWithTimeRemaining }
    } catch (error) {
      console.error('Error fetching public events:', error)
      return reply.status(500).send({ error: 'Failed to fetch events' })
    }
  })

  // Get user's events
  fastify.get('/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return sendError(reply, 401, ErrorMessages.UNAUTHORIZED)
    }

    // Validate Telegram ID
    const userId = Number(telegramId)
    if (!isValidTelegramId(userId)) {
      return sendError(reply, 401, ErrorMessages.INVALID_TELEGRAM_ID)
    }

    const events = await Event.find({ ownerId: userId })
      .sort({ createdAt: -1 })
      .lean()

    return { events }
  })

  // Create event
  fastify.post('/events', async (request: FastifyRequest<{ Body: CreateEventBody }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return sendError(reply, 401, ErrorMessages.UNAUTHORIZED)
    }

    // Validate Telegram ID
    const userId = Number(telegramId)
    if (!isValidTelegramId(userId)) {
      return sendError(reply, 401, ErrorMessages.INVALID_TELEGRAM_ID)
    }

    const { channelId, duration, activityType, winnersCount, prizes, packageId, title, boostsEnabled } = request.body

    // Validate required fields
    if (!channelId || !isValidChannelId(channelId)) {
      return sendError(reply, 400, ErrorMessages.INVALID_CHANNEL_ID)
    }

    if (!duration || !isValidDuration(duration)) {
      return sendError(reply, 400, ErrorMessages.INVALID_DURATION)
    }

    if (!activityType || !isValidActivityType(activityType)) {
      return sendError(reply, 400, ErrorMessages.INVALID_ACTIVITY_TYPE)
    }

    if (!winnersCount || !isValidWinnersCount(winnersCount)) {
      return sendError(reply, 400, ErrorMessages.INVALID_WINNERS_COUNT)
    }

    // Sanitize optional title
    const sanitizedTitle = title ? sanitizeString(title) : undefined

    // Verify user is channel admin
    const isAdmin = await verifyChannelAdmin(channelId, userId)
    if (!isAdmin) {
      return sendError(reply, 403, ErrorMessages.NOT_CHANNEL_ADMIN)
    }

    // Verify bot is admin in channel
    const botIsAdmin = await verifyBotAdmin(channelId)
    if (!botIsAdmin) {
      return sendError(reply, 400, ErrorMessages.BAD_REQUEST, 'Please add the bot as admin to your channel with required permissions')
    }

    // Check user's plan limits
    const user = await User.findOne({ telegramId: userId })
    if (!user) {
      return sendError(reply, 404, ErrorMessages.USER_NOT_FOUND)
    }

    // Check event limits based on plan (skip for admins)
    if (!user.isAdmin) {
      const limits: Record<string, number> = {
        free: 1,
        trial: 3,
        basic: 10,
        advanced: -1, // unlimited
        premium: -1,
      }
      const limit = limits[user.plan]
      if (limit !== -1 && user.eventsThisMonth >= limit) {
        return sendError(reply, 403, ErrorMessages.EVENT_LIMIT_REACHED)
      }
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

    // Update user stats and promote to admin role
    const updateFields: any = {
      $inc: { eventsCreated: 1, eventsThisMonth: 1 },
      $set: { userRole: 'admin' } // Automatically become admin when creating events
    }

    // Mark demo as used if this is first event on free plan
    if (user.plan === 'free' && !user.hasUsedDemo) {
      updateFields.$set.hasUsedDemo = true
      console.log(`✅ User ${userId} used demo event (free plan)`)
    }

    await User.findByIdAndUpdate(user._id, updateFields)

    console.log(`✅ User ${userId} created event and promoted to admin role`)

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

  // Join event - user explicitly opts in to participate
  fastify.post('/events/:id/join', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
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

    try {
      const event = await Event.findById(id).lean()
      if (!event) {
        return sendError(reply, 404, ErrorMessages.EVENT_NOT_FOUND)
      }

      if (event.status !== 'active') {
        return sendError(reply, 400, ErrorMessages.EVENT_NOT_ACTIVE)
      }

      // Check if user already joined (UserEventStats exists)
      const existingStats = await UserEventStats.findOne({
        userId,
        eventId: event._id
      }).lean()

      if (existingStats) {
        return sendError(reply, 400, ErrorMessages.ALREADY_JOINED)
      }

      // Create UserEventStats entry (user has joined)
      await UserEventStats.create({
        userId,
        eventId: event._id,
        points: 0,
        reactionsCount: 0,
        commentsCount: 0,
        repliesCount: 0,
        boostMultiplier: 1.0,
        lastActivityAt: new Date()
      })

      // Increment event participants count
      await Event.findByIdAndUpdate(event._id, {
        $inc: { participantsCount: 1 }
      })

      console.log(`✅ User ${userId} joined event ${id}`)

      return reply.send({
        success: true,
        message: 'Successfully joined the event! Subscribe to the channel and start earning points.'
      })
    } catch (error: any) {
      console.error('Error joining event:', error)

      // Handle duplicate key error (race condition)
      if (error.code === 11000) {
        return reply.status(400).send({ error: 'Already joined this event' })
      }

      return reply.status(500).send({ error: 'Failed to join event' })
    }
  })
}
