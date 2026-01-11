import { Types } from 'mongoose'
import { Event, IEvent, User, PrizeDistribution, IPrizeDistribution } from '../models'
import { GiftPoolService } from './giftPool'
import { TONService } from './ton'
import { GiftsService } from './gifts'

/**
 * Prize Distribution Service
 *
 * Core service for handling all prize types and distribution logic
 * Supports: Telegram Gifts (pool + on-demand), TON transfers, Custom rewards
 */
export class PrizeService {
  /**
   * Validate prize configuration before event creation
   */
  static async validatePrizeConfig(
    prizes: IEvent['prizes'],
    winnersCount: number
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = []

    // Check prize count matches winners count
    if (prizes.length !== winnersCount) {
      errors.push(`Prize count (${prizes.length}) must match winners count (${winnersCount})`)
    }

    // Validate each prize
    for (let i = 0; i < prizes.length; i++) {
      const prize = prizes[i]
      const position = i + 1

      // Validate position
      if (prize.position !== position) {
        errors.push(`Prize ${i} has incorrect position: expected ${position}, got ${prize.position}`)
      }

      // Type-specific validation
      if (prize.type === 'telegram_gift') {
        if (!prize.giftId) {
          errors.push(`Prize position ${position}: giftId required for telegram_gift`)
        }

        // Check pool availability if using pool source
        if (prize.source === 'pool' && prize.giftId) {
          const available = await GiftPoolService.checkAvailability(prize.giftId)
          if (available === 0) {
            errors.push(`Prize position ${position}: Gift ${prize.giftId} not available in pool`)
          }
        }
      } else if (prize.type === 'ton') {
        if (!prize.tonAmount || prize.tonAmount <= 0) {
          errors.push(`Prize position ${position}: tonAmount required and must be positive for TON prizes`)
        }

        // Check if TON service is configured
        if (!TONService.isConfigured()) {
          errors.push(`Prize position ${position}: TON wallet not configured on server`)
        }
      } else if (prize.type === 'custom') {
        if (!prize.customReward?.name) {
          errors.push(`Prize position ${position}: customReward.name required for custom prizes`)
        }
      } else {
        errors.push(`Prize position ${position}: Invalid prize type '${prize.type}'`)
      }
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * Main prize resolution flow - called when event completes
   */
  static async resolvePrizes(
    eventId: string | Types.ObjectId,
    winners: Array<{ telegramId: number; position: number }>
  ): Promise<void> {
    const event = await Event.findById(eventId)
    if (!event) {
      throw new Error('Event not found')
    }

    console.log(`📦 Resolving prizes for event ${eventId}, ${winners.length} winners`)

    for (const winner of winners) {
      const prize = event.prizes[winner.position - 1]
      if (!prize) {
        console.error(`No prize configured for position ${winner.position}`)
        continue
      }

      try {
        await this.sendPrize(winner.telegramId, prize, winner.position, eventId)
      } catch (error) {
        console.error(`Failed to send prize to winner ${winner.telegramId}:`, error)
      }

      // Rate limit between sends
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  /**
   * Send individual prize with retry tracking
   */
  static async sendPrize(
    winnerId: number,
    prize: IEvent['prizes'][0],
    position: number,
    eventId: string | Types.ObjectId
  ): Promise<void> {
    // Create or find existing distribution record
    let distribution = await PrizeDistribution.findOne({
      eventId,
      winnerId,
      position
    })

    if (!distribution) {
      distribution = new PrizeDistribution({
        eventId,
        winnerId,
        position,
        prizeType: prize.type,
        status: 'pending',
        attempts: 0
      })
    }

    // Check if already sent
    if (distribution.status === 'sent') {
      console.log(`Prize already sent to winner ${winnerId} at position ${position}`)
      return
    }

    // Check max retries
    if (distribution.attempts >= 3) {
      console.error(`Max retries reached for winner ${winnerId} at position ${position}`)
      return
    }

    distribution.status = 'processing'
    distribution.attempts++
    distribution.lastAttemptAt = new Date()

    try {
      if (prize.type === 'telegram_gift') {
        await this.sendTelegramGift(winnerId, prize)
      } else if (prize.type === 'ton') {
        await this.sendTONPrize(winnerId, prize)
      } else if (prize.type === 'custom') {
        await this.markCustomRewardSent(winnerId, prize)
      }

      distribution.status = 'sent'
      distribution.sentAt = new Date()
      distribution.error = undefined

      console.log(`✅ Prize sent to winner ${winnerId} at position ${position}`)
    } catch (error: any) {
      distribution.status = 'failed'
      distribution.error = error.message

      console.error(`❌ Failed to send prize to winner ${winnerId}:`, error)
    }

    await distribution.save()
  }

  /**
   * Send Telegram Gift with pool fallback logic
   */
  private static async sendTelegramGift(
    winnerId: number,
    prize: IEvent['prizes'][0]
  ): Promise<void> {
    if (!prize.giftId) {
      throw new Error('Gift ID required for Telegram gift')
    }

    let source = prize.source || 'pool'

    // Try pool first if configured
    if (source === 'pool') {
      const available = await GiftPoolService.checkAvailability(prize.giftId)

      if (available > 0) {
        // Send from pool
        const sent = await GiftsService.sendGift(
          winnerId,
          prize.giftId,
          `🎁 Congratulations! You won a ${prize.name || 'gift'} from UNIC Gift Pool`
        )

        if (sent) {
          await GiftPoolService.markAsUsed(prize.giftId)
          console.log(`📦 Gift sent from pool: ${prize.giftId}`)
          return
        } else {
          throw new Error('Failed to send gift from pool')
        }
      } else {
        // Fallback to on-demand
        console.log(`⚠️ Pool depleted for ${prize.giftId}, falling back to on-demand`)
        source = 'on_demand'
      }
    }

    // On-demand purchase
    if (source === 'on_demand') {
      const sent = await GiftsService.sendGift(
        winnerId,
        prize.giftId,
        `🎁 Congratulations! You won a ${prize.name || 'gift'}!`
      )

      if (!sent) {
        throw new Error('Failed to send gift (on-demand)')
      }

      // Note: 10% commission would be tracked in payment service
      console.log(`⚡ Gift sent on-demand: ${prize.giftId}`)
    }
  }

  /**
   * Send TON transfer prize
   */
  private static async sendTONPrize(
    winnerId: number,
    prize: IEvent['prizes'][0]
  ): Promise<void> {
    if (!prize.tonAmount || prize.tonAmount <= 0) {
      throw new Error('TON amount required')
    }

    // Get user's TON wallet
    const user = await User.findOne({ telegramId: winnerId })
    if (!user) {
      throw new Error('User not found')
    }

    if (!user.tonWalletAddress) {
      throw new Error('User has no TON wallet connected')
    }

    // Validate address
    if (!TONService.validateAddress(user.tonWalletAddress)) {
      throw new Error('Invalid TON wallet address')
    }

    // Send TON
    const success = await TONService.transferTON(
      user.tonWalletAddress,
      prize.tonAmount,
      'UNIC Event Prize'
    )

    if (!success) {
      throw new Error('TON transfer failed')
    }

    console.log(`💎 Sent ${prize.tonAmount} TON to ${user.tonWalletAddress}`)
  }

  /**
   * Mark custom reward as sent (manual fulfillment)
   */
  private static async markCustomRewardSent(
    winnerId: number,
    prize: IEvent['prizes'][0]
  ): Promise<void> {
    if (!prize.customReward?.name) {
      throw new Error('Custom reward name required')
    }

    // Just log - admin will fulfill manually
    console.log(`🎯 Custom reward '${prize.customReward.name}' marked for winner ${winnerId}`)
    console.log(`   Description: ${prize.customReward.description || 'N/A'}`)

    // Note: Could send notification to admins here
  }

  /**
   * Retry failed prize distribution
   */
  static async retryFailedPrize(distributionId: string): Promise<boolean> {
    const distribution = await PrizeDistribution.findById(distributionId)
    if (!distribution) {
      throw new Error('Distribution not found')
    }

    if (distribution.attempts >= 3) {
      console.error('Max retries already reached')
      return false
    }

    if (distribution.status === 'sent') {
      console.log('Prize already sent')
      return true
    }

    // Get event and prize info
    const event = await Event.findById(distribution.eventId)
    if (!event) {
      throw new Error('Event not found')
    }

    const prize = event.prizes[distribution.position - 1]
    if (!prize) {
      throw new Error('Prize not found')
    }

    // Retry
    await this.sendPrize(distribution.winnerId, prize, distribution.position, distribution.eventId)

    return true
  }

  /**
   * Get failed prize distributions (for admin panel)
   */
  static async getFailedPrizes(limit: number = 50): Promise<IPrizeDistribution[]> {
    return await PrizeDistribution.find({ status: 'failed' })
      .sort({ updatedAt: -1 })
      .limit(limit)
  }

  /**
   * Get prize distribution stats for an event
   */
  static async getEventPrizeStats(eventId: string | Types.ObjectId) {
    const distributions = await PrizeDistribution.find({ eventId })

    return {
      total: distributions.length,
      sent: distributions.filter(d => d.status === 'sent').length,
      pending: distributions.filter(d => d.status === 'pending').length,
      processing: distributions.filter(d => d.status === 'processing').length,
      failed: distributions.filter(d => d.status === 'failed').length,
    }
  }
}
