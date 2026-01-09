import { bot } from './telegram'

/**
 * Telegram Gifts Service
 *
 * Works with Telegram Premium Gifts API
 * Docs: https://core.telegram.org/bots/api#gifts
 */

export interface TelegramGift {
  id: string
  sticker: any // Telegram Sticker object
  starCount: number
  totalCount?: number
  remainingCount?: number
}

export interface GiftOption {
  id: string
  name: string
  starValue: number
  available: boolean
  description: string
}

export class GiftsService {
  /**
   * Get available Telegram gifts
   */
  static async getAvailableGifts(): Promise<GiftOption[]> {
    try {
      // Get gifts from Telegram API
      const gifts = await bot.api.getAvailableGifts()

      return gifts.map((gift: TelegramGift) => ({
        id: gift.id,
        name: `Gift ${gift.starCount} Stars`,
        starValue: gift.starCount,
        available: !gift.remainingCount || gift.remainingCount > 0,
        description: `Premium gift worth ${gift.starCount} Stars`,
      }))
    } catch (error) {
      console.error('Failed to fetch Telegram gifts:', error)

      // Return mock gifts for development
      return this.getMockGifts()
    }
  }

  /**
   * Mock gifts for development
   */
  static getMockGifts(): GiftOption[] {
    return [
      {
        id: 'delicious_cake',
        name: 'Delicious Cake',
        starValue: 10,
        available: true,
        description: 'Sweet cake gift worth 10 Stars',
      },
      {
        id: 'green_star',
        name: 'Green Star',
        starValue: 25,
        available: true,
        description: 'Shining star worth 25 Stars',
      },
      {
        id: 'blue_star',
        name: 'Blue Star',
        starValue: 50,
        available: true,
        description: 'Rare blue star worth 50 Stars',
      },
      {
        id: 'red_star',
        name: 'Red Star',
        starValue: 100,
        available: true,
        description: 'Legendary red star worth 100 Stars',
      },
      {
        id: 'gold_star',
        name: 'Gold Star',
        starValue: 250,
        available: true,
        description: 'Ultimate gold star worth 250 Stars',
      },
    ]
  }

  /**
   * Send gift to user
   */
  static async sendGift(
    userId: number,
    giftId: string,
    text?: string
  ): Promise<boolean> {
    try {
      await bot.api.sendGift(userId, giftId, {
        text,
      })

      console.log(`✅ Gift sent: ${giftId} → user ${userId}`)
      return true
    } catch (error) {
      console.error('Failed to send gift:', error)
      return false
    }
  }

  /**
   * Send gifts to multiple winners
   */
  static async sendGiftsToWinners(
    winners: Array<{ telegramId: number; giftId: string; position: number }>
  ): Promise<{ success: number; failed: number }> {
    let success = 0
    let failed = 0

    for (const winner of winners) {
      const sent = await this.sendGift(
        winner.telegramId,
        winner.giftId,
        `🏆 Congratulations! You won position #${winner.position}`
      )

      if (sent) {
        success++
      } else {
        failed++
      }

      // Rate limit: wait 100ms between sends
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    console.log(`📦 Gifts sent: ${success} success, ${failed} failed`)

    return { success, failed }
  }
}
