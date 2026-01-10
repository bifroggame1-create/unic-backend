import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { User, Event, UserEventStats } from '../models'
import { grantAdminPrivileges } from '../middleware/admin'

interface UpdateUserBody {
  username?: string
  firstName?: string
  lastName?: string
}

export async function userRoutes(fastify: FastifyInstance) {
  // Get current user
  fastify.get('/users/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Get username and name from Telegram headers
    const username = request.headers['x-telegram-username'] as string | undefined
    const firstName = request.headers['x-telegram-firstname'] as string | undefined
    const lastName = request.headers['x-telegram-lastname'] as string | undefined

    let user = await User.findOne({ telegramId: Number(telegramId) })

    if (!user) {
      // Create user if doesn't exist with Telegram data
      const newUser = new User({
        telegramId: Number(telegramId),
        username: username || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
      })
      await grantAdminPrivileges(newUser)
      await newUser.save()
      user = newUser
    } else {
      // Update username/name if changed
      let updated = false
      if (username && user.username !== username) {
        user.username = username
        updated = true
      }
      if (firstName && user.firstName !== firstName) {
        user.firstName = firstName
        updated = true
      }
      if (lastName && user.lastName !== lastName) {
        user.lastName = lastName
        updated = true
      }

      // Re-check admin privileges on every request
      const wasAdmin = user.isAdmin
      const wasPremium = user.plan === 'premium'

      await grantAdminPrivileges(user)

      // Always save if user became admin or if admin status changed
      if (user.isAdmin !== wasAdmin) {
        console.log(`🔑 User ${user.telegramId} admin status changed: ${wasAdmin} → ${user.isAdmin}`)
        updated = true
      }

      if (user.isAdmin && user.plan !== 'premium') {
        console.log(`🔑 Admin ${user.telegramId} upgraded to premium plan`)
        updated = true
      }

      if (updated) {
        await user.save()
        console.log(`✅ User ${user.telegramId} saved with admin=${user.isAdmin}, plan=${user.plan}`)
      }
    }

    return { user: user.toObject() }
  })

  // Update user
  fastify.patch('/users/me', async (request: FastifyRequest<{ Body: UpdateUserBody }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const userDoc = await User.findOne({ telegramId: Number(telegramId) })
    if (!userDoc) {
      return reply.status(404).send({ error: 'User not found' })
    }

    // Update fields
    if (request.body.username) userDoc.username = request.body.username
    if (request.body.firstName) userDoc.firstName = request.body.firstName
    if (request.body.lastName) userDoc.lastName = request.body.lastName

    // Check and grant admin privileges if username matches
    await grantAdminPrivileges(userDoc)
    await userDoc.save()

    const user = userDoc.toObject()
    return { user }
  })

  // Get user stats
  fastify.get('/users/me/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Get username and name from Telegram headers
    const username = request.headers['x-telegram-username'] as string | undefined
    const firstName = request.headers['x-telegram-firstname'] as string | undefined
    const lastName = request.headers['x-telegram-lastname'] as string | undefined

    let user = await User.findOne({ telegramId: Number(telegramId) })
    if (!user) {
      // Create user if doesn't exist with Telegram data
      const newUser = new User({
        telegramId: Number(telegramId),
        username: username || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
      })
      await grantAdminPrivileges(newUser)
      await newUser.save()
      user = newUser
    } else {
      // Update and re-check admin privileges
      let updated = false
      if (username && user.username !== username) {
        user.username = username
        updated = true
      }

      const wasAdmin = user.isAdmin
      await grantAdminPrivileges(user)
      if (user.isAdmin !== wasAdmin || (user.isAdmin && user.plan !== 'premium')) {
        updated = true
      }

      if (updated) {
        await user.save()
      }
    }

    // Get plan limits
    const limits: Record<string, { events: number; channels: number; participants: number }> = {
      free: { events: 1, channels: 1, participants: 100 },
      trial: { events: 3, channels: 1, participants: 1000 },
      basic: { events: 10, channels: 1, participants: 5000 },
      advanced: { events: -1, channels: 3, participants: 50000 },
      premium: { events: -1, channels: 10, participants: -1 },
    }

    return {
      plan: user.plan,
      planExpiresAt: user.planExpiresAt,
      eventsThisMonth: user.eventsThisMonth,
      eventsCreated: user.eventsCreated,
      referralsCount: user.referralsCount,
      referralCode: user.referralCode,
      limits: limits[user.plan],
    }
  })

  // Get dashboard statistics
  fastify.get('/users/me/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const userId = Number(telegramId)
    const user = await User.findOne({ telegramId: userId })

    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }

    // Use aggregation for efficient stats calculation
    const stats = await Event.aggregate([
      { $match: { ownerId: userId } },
      {
        $group: {
          _id: null,
          totalParticipants: { $sum: '$participantsCount' },
          totalReactions: { $sum: '$totalReactions' },
          totalComments: { $sum: '$totalComments' },
          activeEvents: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          }
        }
      }
    ])

    const totalParticipants = stats[0]?.totalParticipants || 0
    const totalReactions = stats[0]?.totalReactions || 0
    const totalComments = stats[0]?.totalComments || 0
    const activeEvents = stats[0]?.activeEvents || 0
    const totalEngagement = totalReactions + totalComments

    // Calculate engagement rate (interactions per participant)
    const engagementRate = totalParticipants > 0
      ? Math.round((totalEngagement / totalParticipants) * 100)
      : 0

    return {
      eventsCreated: user.eventsCreated,
      activeEvents,
      totalParticipants,
      engagementRate,
      totalReactions,
      totalComments,
      plan: user.plan,
      referralsCount: user.referralsCount,
    }
  })

  // Create plan upgrade invoice
  fastify.post('/users/plan-invoice', async (request: FastifyRequest<{ Body: { planId: string } }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const { planId } = request.body

    // Validate plan ID
    const planPrices: Record<string, number> = {
      trial: 100,      // 100 Stars
      basic: 500,      // 500 Stars
      advanced: 2000,  // 2000 Stars
      premium: 5000,   // 5000 Stars
    }

    if (!planId || !planPrices[planId]) {
      return reply.status(400).send({ error: 'Invalid plan ID' })
    }

    const userId = Number(telegramId)
    const amount = planPrices[planId]

    try {
      const { PaymentService } = await import('../services/payment')
      const { invoiceLink, paymentId } = await PaymentService.createPlanUpgradeInvoice(
        userId,
        planId,
        amount
      )

      return {
        invoiceLink,
        paymentId,
        amount,
        planId,
      }
    } catch (error: any) {
      console.error('Error creating plan invoice:', error)
      return reply.status(500).send({ error: 'Failed to create invoice' })
    }
  })

  // Upgrade user plan
  fastify.post('/users/upgrade', async (request: FastifyRequest<{ Body: { planId: string; paymentId: string } }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const { planId, paymentId } = request.body

    // Validate plan ID
    const validPlans = ['trial', 'basic', 'advanced', 'premium']
    if (!planId || !validPlans.includes(planId)) {
      return reply.status(400).send({ error: 'Invalid plan ID' })
    }

    // Validate payment ID
    if (!paymentId || typeof paymentId !== 'string') {
      return reply.status(400).send({ error: 'Invalid payment ID' })
    }

    const user = await User.findOne({ telegramId: Number(telegramId) })
    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }

    // Verify payment
    const { PaymentService } = await import('../services/payment')
    const payment = await PaymentService.getPayment(paymentId)

    if (!payment) {
      return reply.status(404).send({ error: 'Payment not found' })
    }

    if (payment.type !== 'plan_upgrade') {
      return reply.status(400).send({ error: 'Invalid payment type' })
    }

    if (payment.status !== 'success') {
      return reply.status(400).send({ error: 'Payment not completed' })
    }

    if (payment.userId !== user.telegramId) {
      return reply.status(403).send({ error: 'Unauthorized payment' })
    }

    // Verify payment is for the correct plan
    if (payment.metadata?.planId !== planId) {
      return reply.status(400).send({ error: 'Payment plan mismatch' })
    }

    // Calculate plan expiry (30 days from now)
    const expiryDate = new Date()
    expiryDate.setDate(expiryDate.getDate() + 30)

    // Update user plan
    user.plan = planId as 'trial' | 'basic' | 'advanced' | 'premium'
    user.planExpiresAt = expiryDate
    // Reset events count to allow creating events with new plan limits
    user.eventsThisMonth = 0
    await user.save()

    console.log(`✅ User ${user.telegramId} upgraded to ${planId} plan until ${expiryDate.toISOString()}`)

    return {
      success: true,
      plan: user.plan,
      planExpiresAt: user.planExpiresAt,
      message: `Successfully upgraded to ${planId} plan`,
    }
  })

  // Apply referral code
  fastify.post('/users/referral', async (request: FastifyRequest<{ Body: { code: string } }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const { code } = request.body

    const user = await User.findOne({ telegramId: Number(telegramId) })
    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }

    if (user.referredBy) {
      return reply.status(400).send({ error: 'Referral code already applied' })
    }

    // Find referrer
    const referrer = await User.findOne({ referralCode: code })
    if (!referrer) {
      return reply.status(404).send({ error: 'Invalid referral code' })
    }

    if (referrer.telegramId === user.telegramId) {
      return reply.status(400).send({ error: 'Cannot use your own referral code' })
    }

    // Apply referral
    user.referredBy = code
    await user.save()

    // Update referrer
    await User.findByIdAndUpdate(referrer._id, {
      $inc: { referralsCount: 1 },
    })

    return { success: true }
  })
}
