import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import dotenv from 'dotenv'
import path from 'path'

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') })

import { connectDB } from './database'
import { registerRoutes } from './routes'
import { initBot, handleWebhook, handleChannelReaction, handleChannelComment } from './services/telegram'
import { SchedulerService } from './services/scheduler'

const PORT = parseInt(process.env.PORT || '3001', 10)
const HOST = process.env.HOST || '0.0.0.0'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
})

// Startup
async function start() {
  try {
    console.log('='.repeat(50))
    console.log('🚀 UNIC Backend Starting...')
    console.log('='.repeat(50))

    // Connect to MongoDB
    await connectDB()

    // Register rate limiting
    await fastify.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
    })

    // CORS
    await fastify.register(cors, {
      origin: [
        FRONTEND_URL,
        'http://localhost:3000',
        /\.vercel\.app$/,
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Telegram-Id'],
    })

    // Security headers
    await fastify.register(helmet, {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })

    // Register routes
    await registerRoutes(fastify)

    // Unified Telegram webhook endpoint
    fastify.post('/webhook', async (request, reply) => {
      const body = request.body as any

      try {
        // Handle message reactions (for scoring)
        if (body.message_reaction) {
          const reaction = body.message_reaction
          await handleChannelReaction(
            reaction.chat.id,
            reaction.user?.id || reaction.actor_chat?.id,
            reaction.user?.username
          )
        }

        // Handle channel posts with comments
        if (body.channel_post) {
          // Channel post - could track for context
        }

        // Handle messages in linked discussion groups
        if (body.message) {
          const msg = body.message
          // Check if it's a comment in channel's linked group
          if (msg.reply_to_message?.forward_from_chat || msg.is_automatic_forward === false) {
            const isReply = !!msg.reply_to_message && !msg.reply_to_message.forward_from_chat
            const channelId = msg.reply_to_message?.forward_from_chat?.id || msg.sender_chat?.id
            if (channelId && msg.from) {
              await handleChannelComment(
                channelId,
                msg.from.id,
                msg.from.username,
                msg.from.first_name,
                isReply
              )
            }
          }
        }

        // Pass to bot for command handling
        await handleWebhook(body)

        return { ok: true }
      } catch (error) {
        fastify.log.error(error, 'Webhook error')
        return { ok: true } // Always return ok to Telegram
      }
    })

    // Endpoint to set webhook URL
    fastify.get('/webhook/setup', async (request, reply) => {
      const webhookUrl = process.env.WEBHOOK_URL
      if (!webhookUrl) {
        return { error: 'WEBHOOK_URL not configured' }
      }

      try {
        const { setWebhookUrl } = await import('./services/telegram')
        const result = await setWebhookUrl(webhookUrl)
        return { success: true, result }
      } catch (error: any) {
        return { error: error.message }
      }
    })

    // Endpoint to check webhook status
    fastify.get('/webhook/info', async (request, reply) => {
      try {
        const { getWebhookInfo } = await import('./services/telegram')
        const info = await getWebhookInfo()
        return { info }
      } catch (error: any) {
        return { error: error.message }
      }
    })

    // Initialize Telegram Bot
    if (process.env.BOT_TOKEN) {
      await initBot()
    } else {
      console.log('⚠️ BOT_TOKEN not set, bot disabled')
    }

    // Start event scheduler
    SchedulerService.start()

    // Start server
    await fastify.listen({ port: PORT, host: HOST })
    console.log(`🚀 Server running at http://${HOST}:${PORT}`)
    console.log(`📱 Frontend URL: ${FRONTEND_URL}`)

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, shutting down...`)
      SchedulerService.stop()
      await fastify.close()
      process.exit(0)
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))

  } catch (error) {
    console.error('❌ Failed to start server:', error)
    process.exit(1)
  }
}

start()
