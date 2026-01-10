import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Channel } from '../models'
import { verifyChannelAdmin, verifyBotAdmin, getChannelInfo } from '../services/telegram'
import { isValidTelegramId, isValidChannelId, isValidObjectId, sanitizeString } from '../utils/validation'

interface AddChannelBody {
  channelId?: number
  username?: string
}

export async function channelRoutes(fastify: FastifyInstance) {
  // Get user's channels
  fastify.get('/channels', async (request: FastifyRequest, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Validate Telegram ID
    const userId = Number(telegramId)
    if (!isValidTelegramId(userId)) {
      return reply.status(401).send({ error: 'Invalid Telegram ID' })
    }

    const channels = await Channel.find({ ownerId: userId })
      .sort({ addedAt: -1 })
      .lean()

    return { channels }
  })

  // Add/verify channel
  fastify.post('/channels', async (request: FastifyRequest<{ Body: AddChannelBody }>, reply: FastifyReply) => {
    const telegramId = request.headers['x-telegram-id']
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Validate Telegram ID
    const userId = Number(telegramId)
    if (!isValidTelegramId(userId)) {
      return reply.status(401).send({ error: 'Invalid Telegram ID' })
    }

    const { channelId, username } = request.body

    // Validate input - must have either channelId or username
    if (!channelId && !username) {
      return reply.status(400).send({ error: 'Either channelId or username is required' })
    }

    // Validate channel ID if provided
    if (channelId && !isValidChannelId(channelId)) {
      return reply.status(400).send({ error: 'Invalid channelId' })
    }

    // Sanitize username if provided
    const sanitizedUsername = username ? sanitizeString(username.replace('@', '')) : undefined

    // Get channel info
    const channelIdentifier = channelId || `@${sanitizedUsername}`
    const info = await getChannelInfo(channelIdentifier)

    if (!info) {
      return reply.status(404).send({ error: 'Channel not found. Make sure the bot is added as admin.' })
    }

    // Verify user is channel admin
    const isAdmin = await verifyChannelAdmin(info.id, userId)
    if (!isAdmin) {
      return reply.status(403).send({ error: 'You must be an admin of this channel' })
    }

    // Verify bot is admin
    const botIsAdmin = await verifyBotAdmin(info.id)
    if (!botIsAdmin) {
      return reply.status(400).send({ error: 'Please add the bot as admin to your channel with required permissions' })
    }

    // Upsert channel
    const channel = await Channel.findOneAndUpdate(
      { chatId: info.id },
      {
        $set: {
          username: info.username,
          title: info.title,
          ownerId: userId,
          isVerified: true,
          subscribersCount: info.subscribersCount,
        },
      },
      { upsert: true, new: true }
    )

    return { channel }
  })

  // Remove channel
  fastify.delete('/channels/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
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

    // Validate channel ID
    if (!isValidObjectId(id)) {
      return reply.status(400).send({ error: 'Invalid channel ID format' })
    }

    const channel = await Channel.findById(id).lean()
    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' })
    }

    if (channel.ownerId !== userId) {
      return reply.status(403).send({ error: 'Not your channel' })
    }

    await Channel.findByIdAndDelete(id)

    return { success: true }
  })

  // Refresh channel info
  fastify.post('/channels/:id/refresh', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
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

    // Validate channel ID
    if (!isValidObjectId(id)) {
      return reply.status(400).send({ error: 'Invalid channel ID format' })
    }

    const channel = await Channel.findById(id)
    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' })
    }

    if (channel.ownerId !== userId) {
      return reply.status(403).send({ error: 'Not your channel' })
    }

    const info = await getChannelInfo(channel.chatId)
    if (info) {
      channel.title = info.title
      channel.username = info.username
      channel.subscribersCount = info.subscribersCount
      await channel.save()
    }

    return { channel }
  })
}
