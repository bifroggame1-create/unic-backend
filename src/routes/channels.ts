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
    console.log(`🔵 [POST /channels] User ${userId} adding channel:`, { channelId, username })

    // Validate input - must have either channelId or username
    if (!channelId && !username) {
      console.log(`❌ Missing channelId and username`)
      return reply.status(400).send({ error: 'Either channelId or username is required' })
    }

    // Validate channel ID if provided
    if (channelId && !isValidChannelId(channelId)) {
      console.log(`❌ Invalid channelId: ${channelId}`)
      return reply.status(400).send({ error: 'Invalid channelId' })
    }

    // Sanitize username if provided
    const sanitizedUsername = username ? sanitizeString(username.replace('@', '')) : undefined
    console.log(`📝 Sanitized username: ${sanitizedUsername}`)

    // Get channel info
    const channelIdentifier = channelId || `@${sanitizedUsername}`
    console.log(`🔍 Getting channel info for: ${channelIdentifier}`)
    const info = await getChannelInfo(channelIdentifier)

    if (!info) {
      console.log(`❌ Channel not found: ${channelIdentifier}`)
      return reply.status(404).send({ error: 'Channel not found. Make sure the bot is added as admin.' })
    }
    console.log(`✅ Channel info retrieved:`, info)

    // Verify user is channel admin
    console.log(`🔍 Verifying user ${userId} is admin of channel ${info.id}`)
    const isAdmin = await verifyChannelAdmin(info.id, userId)
    if (!isAdmin) {
      console.log(`❌ User ${userId} is not admin of channel ${info.id}`)
      return reply.status(403).send({ error: 'You must be an admin of this channel' })
    }
    console.log(`✅ User ${userId} is admin of channel ${info.id}`)

    // Verify bot is admin
    console.log(`🔍 Verifying bot is admin of channel ${info.id}`)
    const botIsAdmin = await verifyBotAdmin(info.id)
    if (!botIsAdmin) {
      console.log(`❌ Bot is not admin of channel ${info.id}`)
      return reply.status(400).send({ error: 'Please add the bot as admin to your channel with required permissions' })
    }
    console.log(`✅ Bot is admin of channel ${info.id}`)

    // Upsert channel
    console.log(`💾 Upserting channel to database:`, {
      chatId: info.id,
      username: info.username,
      title: info.title,
      ownerId: userId
    })
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

    console.log(`✅ Channel added successfully:`, {
      _id: channel._id,
      chatId: channel.chatId,
      title: channel.title
    })
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
