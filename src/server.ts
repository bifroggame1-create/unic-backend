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
import { errorHandler, sendError, ErrorMessages } from './utils/errors'
import { validateInitData } from './middleware/validateInitData'

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
    fastify.log.info('='.repeat(50))
    fastify.log.info('UNIC Backend Starting...')
    fastify.log.info('='.repeat(50))

    // Connect to MongoDB
    await connectDB()

    // Security headers (MUST BE FIRST)
    await fastify.register(helmet, {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })

    // CORS (SECOND)
    await fastify.register(cors, {
      origin: [
        FRONTEND_URL,
        'http://localhost:3000',
        'https://testunic1.vercel.app',
        /\.vercel\.app$/,
        /t\.me$/,
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Telegram-Id',
        'x-telegram-id',
        'x-telegram-init-data',
        'x-telegram-username',
        'x-telegram-firstname',
        'x-telegram-lastname',
      ],
      exposedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Telegram-Id',
        'x-telegram-id',
        'x-telegram-init-data',
        'x-telegram-username',
        'x-telegram-firstname',
        'x-telegram-lastname',
      ],
      preflight: true,
      preflightContinue: false,
      optionsSuccessStatus: 204,
    })

    // Register rate limiting (THIRD)
    await fastify.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
    })

    // Register global error handler
    fastify.setErrorHandler(errorHandler)

    // Register Telegram initData validation middleware (optional for MVP)
    // This validates that requests come from legitimate Telegram users
    fastify.addHook('preHandler', validateInitData)

    // Register routes
    await registerRoutes(fastify)

    // Unified Telegram webhook endpoint
    fastify.post('/webhook', async (request, reply) => {
      // Verify Telegram webhook secret token
      const secretToken = request.headers['x-telegram-bot-api-secret-token'] as string
      const expectedToken = process.env.WEBHOOK_SECRET

      if (expectedToken && secretToken !== expectedToken) {
        return sendError(reply, 403, ErrorMessages.FORBIDDEN, 'Invalid webhook secret token')
      }

      const body = request.body as any

      try {
        // Log all webhook events for debugging
        fastify.log.info({
          update_id: body.update_id,
          type: Object.keys(body).filter(k => k !== 'update_id'),
          timestamp: new Date().toISOString()
        }, 'Webhook received')

        // Handle message reactions (for scoring)
        if (body.message_reaction) {
          const reaction = body.message_reaction
          fastify.log.info({
            chat_id: reaction.chat.id,
            user_id: reaction.user?.id || reaction.actor_chat?.id,
            username: reaction.user?.username,
            message_id: reaction.message_id,
            new_reaction: reaction.new_reaction,
          }, 'Reaction detected')

          await handleChannelReaction(
            reaction.chat.id,
            reaction.user?.id || reaction.actor_chat?.id,
            reaction.user?.username,
            reaction.message_id
          )
        }

        // Handle channel posts with comments
        if (body.channel_post) {
          fastify.log.info({
            chat_id: body.channel_post.chat.id,
            message_id: body.channel_post.message_id,
            text: body.channel_post.text?.substring(0, 50),
          }, 'Channel post')
        }

        // Handle messages in linked discussion groups
        if (body.message) {
          const msg = body.message
          fastify.log.info({
            chat_id: msg.chat.id,
            from: msg.from?.id,
            is_reply: !!msg.reply_to_message,
            has_forward: !!msg.reply_to_message?.forward_from_chat,
          }, 'Message received')

          // Check if it's a comment in channel's linked group
          if (msg.reply_to_message?.forward_from_chat || msg.is_automatic_forward === false) {
            const isReply = !!msg.reply_to_message && !msg.reply_to_message.forward_from_chat
            const channelId = msg.reply_to_message?.forward_from_chat?.id || msg.sender_chat?.id

            fastify.log.info({
              channel_id: channelId,
              user_id: msg.from?.id,
              is_reply: isReply,
            }, 'Comment/Reply detected')

            if (channelId && msg.from && msg.text) {
              await handleChannelComment(
                channelId,
                msg.from.id,
                msg.text,
                msg.from.username,
                msg.from.first_name,
                isReply,
                msg.message_id
              )
            }
          }
        }

        // Pass to bot for command handling
        await handleWebhook(body)

        return { ok: true }
      } catch (error) {
        fastify.log.error({ error }, 'Webhook processing failed')
        return { ok: true } // Always return ok to Telegram
      }
    })

    // Endpoint to set webhook URL
    fastify.get('/webhook/setup', async (request, reply) => {
      const webhookUrl = process.env.WEBHOOK_URL
      if (!webhookUrl) {
        return sendError(reply, 500, ErrorMessages.INTERNAL_ERROR, 'WEBHOOK_URL not configured')
      }

      try {
        const { setWebhookUrl } = await import('./services/telegram')
        const result = await setWebhookUrl(webhookUrl)
        return { success: true, result }
      } catch (error: any) {
        return sendError(reply, 500, ErrorMessages.TELEGRAM_API_ERROR, error.message)
      }
    })

    // Endpoint to check webhook status
    fastify.get('/webhook/info', async (request, reply) => {
      try {
        const { getWebhookInfo } = await import('./services/telegram')
        const info = await getWebhookInfo()
        return { info }
      } catch (error: any) {
        return sendError(reply, 500, ErrorMessages.TELEGRAM_API_ERROR, error.message)
      }
    })

    // Initialize Telegram Bot
    if (process.env.BOT_TOKEN) {
      await initBot()
    } else {
      fastify.log.warn('BOT_TOKEN not set, bot disabled')
    }

    // Start event scheduler
    SchedulerService.start()

    // Start server
    await fastify.listen({ port: PORT, host: HOST })
    fastify.log.info({ port: PORT, host: HOST, frontend: FRONTEND_URL }, 'Server started')

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      fastify.log.info({ signal }, 'Shutting down server')
      SchedulerService.stop()
      await fastify.close()
      process.exit(0)
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))

  } catch (error) {
    fastify.log.error({ error }, 'Failed to start server')
    process.exit(1)
  }
}

start()
