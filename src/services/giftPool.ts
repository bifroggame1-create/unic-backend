import mongoose from 'mongoose'
import { GiftPool, IGiftPool } from '../models'
import { GiftsService } from './gifts'

/**
 * Gift Pool Management Service
 *
 * Manages UNIC's centralized pool of Telegram Gifts
 * Handles reservations, releases, and availability tracking with race condition protection
 */
export class GiftPoolService {
  /**
   * Sync gifts from Telegram API to local pool metadata
   */
  static async syncGiftsFromTelegram(): Promise<void> {
    try {
      const telegramGifts = await GiftsService.getAvailableGifts()

      for (const gift of telegramGifts) {
        await GiftPool.findOneAndUpdate(
          { giftId: gift.id },
          {
            $setOnInsert: {
              giftId: gift.id,
              name: gift.name,
              stars: gift.starValue,
              totalAvailable: 0,
              reserved: 0,
              used: 0,
              convertStars: gift.starValue,
              requirePremium: false,
              rarity: 'common',
              limited: false
            }
          },
          { upsert: true, new: true }
        )
      }
    } catch (error) {
      console.error('Failed to sync gifts from Telegram:', error)
      throw error
    }
  }

  /**
   * Add gifts to pool manually (admin action)
   */
  static async addToPool(giftId: string, quantity: number): Promise<IGiftPool> {
    if (quantity <= 0) {
      throw new Error('Quantity must be positive')
    }

    const gift = await GiftPool.findOneAndUpdate(
      { giftId },
      { $inc: { totalAvailable: quantity } },
      { new: true, upsert: false }
    )

    if (!gift) {
      throw new Error(`Gift ${giftId} not found in pool. Run sync first.`)
    }

    return gift
  }

  /**
   * Reserve gifts for an event with MongoDB transaction (race condition protection)
   */
  static async reserveGift(giftId: string, quantity: number = 1): Promise<boolean> {
    if (quantity <= 0) {
      throw new Error('Quantity must be positive')
    }

    const session = await mongoose.startSession()
    session.startTransaction()

    try {
      // Atomic check and reserve
      const gift = await GiftPool.findOneAndUpdate(
        {
          giftId,
          // Ensure there are enough unreserved gifts: totalAvailable - reserved - used >= quantity
          $expr: {
            $gte: [
              { $subtract: [{ $subtract: ['$totalAvailable', '$reserved'] }, '$used'] },
              quantity
            ]
          }
        },
        { $inc: { reserved: quantity } },
        { new: true, session }
      )

      if (!gift) {
        await session.abortTransaction()
        return false
      }

      await session.commitTransaction()
      return true
    } catch (error) {
      await session.abortTransaction()
      console.error('Failed to reserve gift:', error)
      throw error
    } finally {
      session.endSession()
    }
  }

  /**
   * Release reserved gifts (e.g., when event is cancelled)
   */
  static async releaseGift(giftId: string, quantity: number = 1): Promise<void> {
    if (quantity <= 0) {
      throw new Error('Quantity must be positive')
    }

    const gift = await GiftPool.findOne({ giftId })
    if (!gift) {
      throw new Error(`Gift ${giftId} not found`)
    }

    if (gift.reserved < quantity) {
      throw new Error('Cannot release more gifts than reserved')
    }

    await GiftPool.findOneAndUpdate(
      { giftId },
      { $inc: { reserved: -quantity } }
    )
  }

  /**
   * Mark gift as used (sent to winner)
   */
  static async markAsUsed(giftId: string, quantity: number = 1): Promise<void> {
    if (quantity <= 0) {
      throw new Error('Quantity must be positive')
    }

    const session = await mongoose.startSession()
    session.startTransaction()

    try {
      const gift = await GiftPool.findOne({ giftId }, null, { session })
      if (!gift) {
        throw new Error(`Gift ${giftId} not found`)
      }

      if (gift.reserved < quantity) {
        throw new Error('Cannot mark more gifts as used than reserved')
      }

      await GiftPool.findOneAndUpdate(
        { giftId },
        {
          $inc: {
            reserved: -quantity,
            used: quantity
          }
        },
        { session }
      )

      await session.commitTransaction()
    } catch (error) {
      await session.abortTransaction()
      throw error
    } finally {
      session.endSession()
    }
  }

  /**
   * Check available quantity for a gift (not reserved, not used)
   */
  static async checkAvailability(giftId: string): Promise<number> {
    const gift = await GiftPool.findOne({ giftId })
    if (!gift) {
      return 0
    }

    return gift.totalAvailable - gift.reserved - gift.used
  }

  /**
   * Get pool statistics for admin dashboard
   */
  static async getPoolStats() {
    const gifts = await GiftPool.find()

    return {
      total: gifts.reduce((sum, g) => sum + g.totalAvailable, 0),
      reserved: gifts.reduce((sum, g) => sum + g.reserved, 0),
      used: gifts.reduce((sum, g) => sum + g.used, 0),
      available: gifts.reduce((sum, g) => sum + (g.totalAvailable - g.reserved - g.used), 0),
      uniqueGifts: gifts.length
    }
  }

  /**
   * Get all gifts available for event creation
   */
  static async getAvailableForEvent(): Promise<IGiftPool[]> {
    return await GiftPool.find({
      $expr: {
        $gt: [{ $subtract: [{ $subtract: ['$totalAvailable', '$reserved'] }, '$used'] }, 0]
      }
    }).sort({ rarity: -1, stars: 1 })
  }

  /**
   * Get all pool gifts (for admin view)
   */
  static async getAllPoolGifts(): Promise<IGiftPool[]> {
    return await GiftPool.find().sort({ rarity: -1, stars: 1 })
  }

  /**
   * Get gift by ID
   */
  static async getGiftById(giftId: string): Promise<IGiftPool | null> {
    return await GiftPool.findOne({ giftId })
  }

  /**
   * Update gift metadata (rarity, limited status, etc.)
   */
  static async updateGiftMetadata(
    giftId: string,
    metadata: Partial<Pick<IGiftPool, 'rarity' | 'limited' | 'requirePremium' | 'name'>>
  ): Promise<IGiftPool | null> {
    return await GiftPool.findOneAndUpdate(
      { giftId },
      { $set: metadata },
      { new: true }
    )
  }
}
