import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { User } from '../models'

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

    let user = await User.findOne({ telegramId: Number(telegramId) }).lean()

    if (!user) {
      // Create user if doesn't exist
      const newUser = new User({
        telegramId: Number(telegramId),
      })
      await newUser.save()
      user = newUser.toObject()
    }

    return { user }
  })

  // Update user
  fastify.patch('/users/me', async (request: FastifyRequest<{ Body: UpdateUserBody }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const user = await User.findOneAndUpdate(
      { telegramId: Number(telegramId) },
      { $set: request.body },
      { new: true }
    ).lean()

    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }

    return { user }
  })

  // Get user stats
  fastify.get('/users/me/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    let user = await User.findOne({ telegramId: Number(telegramId) }).lean()
    if (!user) {
      // Create user if doesn't exist
      const newUser = new User({
        telegramId: Number(telegramId),
      })
      await newUser.save()
      user = newUser.toObject()
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
