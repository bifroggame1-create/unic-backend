import { Bot, Context } from 'grammy'
import { Event, Channel, User } from '../models'
import { recordActivity } from './scoring'

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
  await ctx.reply(
    `📖 **How UNIC Works**\n\n` +
    `1️⃣ Add @UnicBot as admin to your channel\n` +
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
  username?: string
) {
  // Find active event for this channel
  const event = await Event.findOne({
    channelId,
    status: 'active',
    endsAt: { $gt: new Date() },
  })

  if (!event) return null

  const points = await recordActivity(event._id, {
    telegramId: userId,
    username,
    type: 'reaction',
  })

  return { eventId: event._id, points }
}

// Handle channel comments
export async function handleChannelComment(
  channelId: number,
  userId: number,
  username?: string,
  firstName?: string,
  isReply: boolean = false
) {
  const event = await Event.findOne({
    channelId,
    status: 'active',
    endsAt: { $gt: new Date() },
  })

  if (!event) return null

  const points = await recordActivity(event._id, {
    telegramId: userId,
    username,
    firstName,
    type: isReply ? 'reply' : 'comment',
  })

  return { eventId: event._id, points }
}

// Verify channel admin rights
export async function verifyChannelAdmin(channelId: number, userId: number): Promise<boolean> {
  try {
    const member = await bot.api.getChatMember(channelId, userId)
    return ['creator', 'administrator'].includes(member.status)
  } catch {
    return false
  }
}

// Verify bot is admin in channel
export async function verifyBotAdmin(channelId: number): Promise<boolean> {
  try {
    const botInfo = await bot.api.getMe()
    const member = await bot.api.getChatMember(channelId, botInfo.id)
    return ['administrator'].includes(member.status)
  } catch {
    return false
  }
}

// Get channel info
export async function getChannelInfo(channelId: number | string) {
  try {
    const chat = await bot.api.getChat(channelId)
    if (chat.type !== 'channel') return null

    const count = await bot.api.getChatMemberCount(channelId)

    return {
      id: chat.id,
      title: chat.title,
      username: 'username' in chat ? chat.username : undefined,
      subscribersCount: count,
    }
  } catch {
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
    '24h': '24 hours',
    '48h': '48 hours',
    '72h': '72 hours',
    '7d': '7 days',
  }[duration] || duration

  const message = await bot.api.sendMessage(
    channelId,
    `🎁 **Giveaway for Active Subscribers!**\n\n` +
    `React to posts and leave comments to earn points.\n\n` +
    `🏆 TOP-${winnersCount} will receive **Telegram Gifts**\n\n` +
    `📊 Check your position and compete!\n\n` +
    `⏱ Ends in: ${durationText}`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 My Position', web_app: { url: `${webAppUrl}/event/${eventId}` } }],
        ],
      },
    }
  )

  return message.message_id
}

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
