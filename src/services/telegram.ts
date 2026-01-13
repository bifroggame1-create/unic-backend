import { Bot, Context } from 'grammy'
import { Event, Channel, User } from '../models'
import { PointsService } from './points'
import { PaymentService } from './payment'

const BOT_TOKEN = process.env.BOT_TOKEN || ''

export const bot = new Bot(BOT_TOKEN)

// Command: /start
bot.command('start', async (ctx) => {
  const user = ctx.from
  if (!user) return

  // Upsert user
  await User.findOneAndUpdate(
    { telegramId: user.id },
    {
      $set: {
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
      },
    },
    { upsert: true }
  )

  const webAppUrl = process.env.FRONTEND_URL || 'https://unic.app'

  await ctx.reply(
    `👋 Welcome to UNIC!\n\nLaunch engagement events for your Telegram channels and reward your most active subscribers with Gifts.\n\n🚀 Ready to boost your channel's engagement?`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎁 Open UNIC', web_app: { url: webAppUrl } }],
          [{ text: '📖 How it works', callback_data: 'how_it_works' }],
        ],
      },
    }
  )
})

// Callback: How it works
bot.callbackQuery('how_it_works', async (ctx) => {
  await ctx.answerCallbackQuery()

  // Get bot username dynamically
  const botInfo = await bot.api.getMe()
  const botUsername = botInfo.username

  await ctx.reply(
    `📖 **How UNIC Works**\n\n` +
    `1️⃣ Add @${botUsername} as admin to your channel\n` +
    `2️⃣ Create an event in the app\n` +
    `3️⃣ Publish the event post\n` +
    `4️⃣ Your subscribers compete for points\n` +
    `5️⃣ Winners receive Telegram Gifts\n\n` +
    `Points system:\n` +
    `• Reaction = 1 point\n` +
    `• Comment = 3 points\n` +
    `• Reply = 2 points`,
    { parse_mode: 'Markdown' }
  )
})

// Handle channel post reactions (webhook will call this)
export async function handleChannelReaction(
  channelId: number,
  userId: number,
  username?: string,
  messageId?: number
) {
  const { ProcessedActivity } = await import('../models')

  // Check if already processed (deduplication)
  if (messageId) {
    try {
      await ProcessedActivity.create({
        userId,
        channelId,
        messageId,
        activityType: 'reaction',
      })
    } catch (error: any) {
      // Duplicate key error - already processed
      if (error.code === 11000) {
        console.log(`⚠️ Duplicate reaction detected for user ${userId} on message ${messageId}`)
        return null
      }
      throw error
    }
  }

  // Find active event for this channel
  const event = await Event.findOne({
    channelId,
    status: 'active',
    endsAt: { $gt: new Date() },
  })

  if (!event) return null

  // Award points using PointsService
  const earnedPoints = await PointsService.handleReaction(
    userId,
    event._id,
    messageId || 0
  )

  console.log(`✅ User ${userId} earned ${earnedPoints} points for reaction`)

  return { eventId: event._id, points: earnedPoints }
}

// Handle channel comments
export async function handleChannelComment(
  channelId: number,
  userId: number,
  commentText: string,
  username?: string,
  firstName?: string,
  isReply: boolean = false,
  messageId?: number
) {
  const { ProcessedActivity } = await import('../models')
  const { checkRateLimit } = await import('../middleware/rateLimit')

  // Rate limiting: 10 comments per hour
  const rateLimit = checkRateLimit(userId, 'comments')
  if (!rateLimit.allowed) {
    console.log(`⚠️ Rate limit exceeded for user ${userId}: comments (reset in ${Math.ceil(rateLimit.resetIn / 60000)} min)`)
    return null
  }

  // Check if already processed (deduplication)
  if (messageId) {
    try {
      await ProcessedActivity.create({
        userId,
        channelId,
        messageId,
        activityType: 'comment',
      })
    } catch (error: any) {
      // Duplicate key error - already processed
      if (error.code === 11000) {
        console.log(`⚠️ Duplicate comment detected for user ${userId} on message ${messageId}`)
        return null
      }
      throw error
    }
  }

  const event = await Event.findOne({
    channelId,
    status: 'active',
    endsAt: { $gt: new Date() },
  })

  if (!event) return null

  // Award points using PointsService (with validation)
  try {
    const earnedPoints = await PointsService.handleComment(
      userId,
      event._id,
      messageId || 0,
      commentText,
      isReply
    )

    console.log(`✅ User ${userId} earned ${earnedPoints} points for ${isReply ? 'reply' : 'comment'}`)
    return { eventId: event._id, points: earnedPoints }
  } catch (error: any) {
    // Log spam/invalid comments but don't throw
    console.log(`⚠️ Comment rejected: ${error.message}`)
    return null
  }
}

// Verify channel admin rights
export async function verifyChannelAdmin(channelId: number, userId: number): Promise<boolean> {
  try {
    console.log(`🔍 [verifyChannelAdmin] Checking if user ${userId} is admin of channel ${channelId}`)

    const member = await bot.api.getChatMember(channelId, userId)
    console.log(`👤 User member status:`, {
      userId,
      channelId,
      status: member.status,
      user: member.user
    })

    const isAdmin = ['creator', 'administrator'].includes(member.status)

    if (isAdmin) {
      console.log(`✅ User ${userId} is ${member.status} of channel ${channelId}`)
    } else {
      console.log(`❌ User ${userId} is not admin of channel ${channelId}, status: ${member.status}`)
    }

    return isAdmin
  } catch (error: any) {
    console.error(`❌ Error checking user admin status:`, {
      userId,
      channelId,
      error: error.message,
      response: error.response?.description
    })
    return false
  }
}

// Verify bot is admin in channel with required permissions
export async function verifyBotAdmin(channelId: number): Promise<boolean> {
  try {
    console.log(`🔍 [verifyBotAdmin] Checking bot admin status for channel ${channelId}`)

    const botInfo = await bot.api.getMe()
    console.log(`🤖 Bot info:`, { id: botInfo.id, username: botInfo.username })

    const member = await bot.api.getChatMember(channelId, botInfo.id)
    console.log(`👤 Bot member status:`, {
      status: member.status,
      user: member.user,
      permissions: JSON.stringify(member, null, 2)
    })

    if (member.status !== 'administrator') {
      console.log(`❌ Bot is not admin in channel ${channelId}, status: ${member.status}`)
      return false
    }

    // For channels, we primarily need can_post_messages permission
    // Other permissions might not be available for bots in channels
    if ('can_post_messages' in member) {
      const canPost = (member as any).can_post_messages
      console.log(`📝 can_post_messages:`, canPost)

      if (!canPost) {
        console.log(`⚠️ Bot cannot post messages in channel ${channelId}`)
        // Don't fail - bot might still work for reading messages
      }
    }

    console.log(`✅ Bot is admin in channel ${channelId}`)
    return true
  } catch (error: any) {
    console.error(`❌ Error verifying bot admin status for channel ${channelId}:`, {
      error: error.message,
      stack: error.stack,
      response: error.response?.description
    })
    return false
  }
}

// Get channel info
export async function getChannelInfo(channelId: number | string) {
  try {
    console.log(`🔍 [getChannelInfo] Getting info for channel: ${channelId}`)

    const chat = await bot.api.getChat(channelId)
    console.log(`📋 Chat info:`, {
      id: chat.id,
      type: chat.type,
      title: chat.title,
      username: 'username' in chat ? chat.username : undefined
    })

    if (chat.type !== 'channel') {
      console.log(`❌ Not a channel, type: ${chat.type}`)
      return null
    }

    const count = await bot.api.getChatMemberCount(channelId)
    console.log(`👥 Subscriber count: ${count}`)

    const result = {
      id: chat.id,
      title: chat.title,
      username: 'username' in chat ? chat.username : undefined,
      subscribersCount: count,
    }

    console.log(`✅ Channel info retrieved:`, result)
    return result
  } catch (error: any) {
    console.error(`❌ Error getting channel info for ${channelId}:`, {
      error: error.message,
      stack: error.stack,
      response: error.response?.description
    })
    return null
  }
}

// Send event post to channel
export async function sendEventPost(
  channelId: number,
  eventId: string,
  winnersCount: number,
  duration: string,
  webAppUrl: string
) {
  const durationText = {
    '24h': '24 часа',
    '48h': '48 часов',
    '72h': '72 часа',
    '7d': '7 дней',
  }[duration] || duration

  const message = await bot.api.sendMessage(
    channelId,
    `🎁 **КОНКУРС АКТИВНОСТИ!**\n\n` +
    `📌 **Как участвовать:**\n` +
    `• ❤️ Ставьте реакции на ЛЮБЫЕ посты канала = **1 балл**\n` +
    `• 💬 Пишите комментарии в обсуждениях = **3 балла**\n` +
    `• 💭 Отвечайте на комментарии других = **2 балла**\n\n` +
    `🏆 **TOP-${winnersCount}** получат **Telegram Gifts**!\n` +
    `⏱ **Осталось:** ${durationText}\n\n` +
    `👇 Смотрите свою позицию в рейтинге:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Моя позиция в рейтинге', web_app: { url: `${webAppUrl}/event/${eventId}` } }],
          [{ text: '🎁 Посмотреть призы', web_app: { url: `${webAppUrl}/event/${eventId}` } }],
        ],
      },
    }
  )

  // Pin the announcement message so it's visible to all subscribers
  try {
    await bot.api.pinChatMessage(channelId, message.message_id, {
      disable_notification: false, // Notify users about the pinned message
    })
    console.log(`📌 Event announcement pinned in channel ${channelId}`)
  } catch (error) {
    console.error('Failed to pin message (bot needs pin_messages permission):', error)
  }

  return message.message_id
}

// Handle pre-checkout query (approve payment)
bot.on('pre_checkout_query', async (ctx) => {
  try {
    const paymentId = ctx.preCheckoutQuery.invoice_payload

    // Verify payment exists and is pending
    const payment = await PaymentService.getPayment(paymentId)

    if (!payment || payment.status !== 'pending') {
      await ctx.answerPreCheckoutQuery(false, {
        error_message: 'Payment not found or already processed',
      })
      return
    }

    // Approve the payment
    await ctx.answerPreCheckoutQuery(true)
  } catch (error) {
    console.error('Pre-checkout query error:', error)
    await ctx.answerPreCheckoutQuery(false, {
      error_message: 'Payment verification failed',
    })
  }
})

// Handle successful payment
bot.on('message:successful_payment', async (ctx) => {
  try {
    const payment = ctx.message.successful_payment

    if (!payment) return

    const paymentId = payment.invoice_payload
    const telegramPaymentId = payment.telegram_payment_charge_id

    // Mark payment as successful
    const paymentRecord = await PaymentService.handleSuccessfulPayment(
      telegramPaymentId,
      paymentId
    )

    if (!paymentRecord) return

    // Send confirmation message
    const { type, amount, metadata } = paymentRecord

    if (type === 'boost') {
      const boostType = metadata?.boostType as 'x2_24h' | 'x1.5_forever'
      const boostName = boostType === 'x2_24h' ? '2x Boost (24h)' : '1.5x Boost (Forever)'

      await ctx.reply(
        `✅ **Payment Successful!**\\n\\n` +
        `You purchased: ${boostName}\\n` +
        `Amount: ${amount} ⭐\\n\\n` +
        `Your boost will be activated shortly. Return to the event to see your new multiplier!`,
        { parse_mode: 'Markdown' }
      )
    }
  } catch (error) {
    console.error('Successful payment handler error:', error)
  }
})

// Webhook handler - process update directly
export async function handleWebhook(update: any) {
  await bot.handleUpdate(update)
}

// Set webhook URL with all needed update types
export async function setWebhookUrl(url: string) {
  const result = await bot.api.setWebhook(url, {
    allowed_updates: [
      'message',
      'channel_post',
      'message_reaction',
      'callback_query',
      'pre_checkout_query',
    ],
    drop_pending_updates: true,
  })
  console.log('✅ Webhook set to:', url)
  return result
}

// Get current webhook info
export async function getWebhookInfo() {
  return bot.api.getWebhookInfo()
}

// Delete webhook (switch to polling)
export async function deleteWebhook() {
  return bot.api.deleteWebhook({ drop_pending_updates: true })
}

// Initialize bot (polling for dev, webhook for prod)
export async function initBot() {
  const webhookUrl = process.env.WEBHOOK_URL

  if (process.env.NODE_ENV === 'production' && webhookUrl) {
    await setWebhookUrl(webhookUrl)
  } else if (webhookUrl) {
    // Dev with webhook (e.g., ngrok)
    await setWebhookUrl(webhookUrl)
  } else {
    // Local dev - use polling
    await deleteWebhook()
    bot.start()
    console.log('✅ Bot started (polling)')
  }
}

/**
 * Get user avatar URL from Telegram
 * Returns the URL to the user's profile photo
 */
export async function getUserAvatarUrl(userId: number): Promise<string | null> {
  try {
    const photos = await bot.api.getUserProfilePhotos(userId, { limit: 1 })

    if (photos.total_count === 0 || photos.photos.length === 0) {
      return null
    }

    // Get the largest photo size (last in array)
    const photo = photos.photos[0]
    const largestPhoto = photo[photo.length - 1]

    // Get file info to get file_path
    const file = await bot.api.getFile(largestPhoto.file_id)

    // Construct download URL
    if (file.file_path) {
      return `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    }

    return null
  } catch (error) {
    console.error(`Failed to get avatar for user ${userId}:`, error)
    return null
  }
}
