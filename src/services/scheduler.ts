import { Event } from '../models'
import { PointsService } from './points'
import { GiftsService } from './gifts'

/**
 * Background scheduler for event lifecycle management
 *
 * Handles:
 * - Event completion when time runs out
 * - Winner selection
 * - Gift distribution
 */

export class SchedulerService {
  private static intervalId: NodeJS.Timeout | null = null

  /**
   * Start the scheduler (runs every minute)
   */
  static start() {
    if (this.intervalId) {
      console.log('⏰ Scheduler already running')
      return
    }

    console.log('⏰ Starting event scheduler...')

    // Run immediately on start
    this.processEvents()
    this.checkExpiredSubscriptions()

    // Then run every minute
    this.intervalId = setInterval(() => {
      this.processEvents()
    }, 60 * 1000) // Every 60 seconds

    // Check subscriptions every hour
    setInterval(() => {
      this.checkExpiredSubscriptions()
    }, 60 * 60 * 1000) // Every hour
  }

  /**
   * Stop the scheduler
   */
  static stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.log('⏰ Scheduler stopped')
    }
  }

  /**
   * Check and downgrade expired subscriptions
   */
  private static async checkExpiredSubscriptions() {
    try {
      const { User } = await import('../models')

      // Find users with expired plans
      const expiredUsers = await User.find({
        plan: { $ne: 'free' },
        planExpiresAt: { $lt: new Date() }
      })

      if (expiredUsers.length > 0) {
        console.log(`⏰ Found ${expiredUsers.length} expired subscriptions`)
      }

      for (const user of expiredUsers) {
        const oldPlan = user.plan
        user.plan = 'free'
        user.planExpiresAt = undefined
        user.eventsThisMonth = 0 // Reset event counter
        await user.save()

        console.log(`📉 User ${user.telegramId} downgraded from ${oldPlan} to free (subscription expired)`)
      }
    } catch (error) {
      console.error('⏰ Error checking expired subscriptions:', error)
    }
  }

  /**
   * Process all events that need attention
   */
  private static async processEvents() {
    try {
      // Find active events that have ended
      const endedEvents = await Event.find({
        status: 'active',
        endsAt: { $lt: new Date() },
      })

      if (endedEvents.length > 0) {
        console.log(`⏰ Processing ${endedEvents.length} ended events...`)
      }

      for (const event of endedEvents) {
        await this.completeEvent(event._id.toString())
      }
    } catch (error) {
      console.error('⏰ Scheduler error:', error)
    }
  }

  /**
   * Complete an event: select winners and send gifts
   */
  private static async completeEvent(eventId: string) {
    try {
      console.log(`🏁 Completing event ${eventId}...`)

      const event = await Event.findById(eventId)
      if (!event) {
        console.error(`Event not found: ${eventId}`)
        return
      }

      // Select winners using PointsService
      const winners = await PointsService.selectWinners(eventId)

      if (winners.length === 0) {
        console.log(`No participants in event ${eventId}`)
        event.status = 'completed'
        await event.save()
        return
      }

      console.log(`🏆 Selected ${winners.length} winners for event ${eventId}`)

      // Map winners to prizes
      const winnersWithGifts = winners.map((winner, index) => {
        const prize = event.prizes[index]
        return {
          telegramId: winner.telegramId,
          username: winner.username,
          points: winner.points,
          position: winner.position,
          giftId: prize?.giftId || 'delicious_cake', // Default gift
          giftSent: false,
        }
      })

      // Update event with winners
      event.winners = winnersWithGifts
      event.status = 'completed'
      await event.save()

      console.log(`📦 Sending gifts to ${winnersWithGifts.length} winners...`)

      // Send gifts
      const giftsToSend = winnersWithGifts.map((w) => ({
        telegramId: w.telegramId,
        giftId: w.giftId,
        position: w.position,
      }))

      const result = await GiftsService.sendGiftsToWinners(giftsToSend)

      console.log(`✅ Event ${eventId} completed: ${result.success} gifts sent, ${result.failed} failed`)

      // Update gift sent status
      for (let i = 0; i < winnersWithGifts.length; i++) {
        if (i < result.success) {
          event.winners[i].giftSent = true
        }
      }

      await event.save()

      // Schedule Second Chance draw for 1 hour later
      setTimeout(async () => {
        await this.runSecondChanceDraw(eventId)
      }, 60 * 60 * 1000) // 1 hour

    } catch (error) {
      console.error(`Failed to complete event ${eventId}:`, error)
    }
  }

  /**
   * Run Second Chance draw for completed event
   */
  private static async runSecondChanceDraw(eventId: string) {
    try {
      console.log(`🎲 Running Second Chance draw for event ${eventId}...`)

      const event = await Event.findById(eventId)
      if (!event || event.status !== 'completed') {
        console.log(`Event ${eventId} is not in completed status, skipping Second Chance`)
        return
      }

      // Select Second Chance winners (up to 3)
      const secondChanceWinners = await PointsService.selectSecondChanceWinners(eventId, 3)

      if (secondChanceWinners.length === 0) {
        console.log(`No Second Chance entries for event ${eventId}`)
        return
      }

      console.log(`🍀 Selected ${secondChanceWinners.length} Second Chance winners`)

      // Add Second Chance winners to event
      const newWinners = secondChanceWinners.map((winner, index) => ({
        telegramId: winner.telegramId,
        username: winner.username,
        points: 0,
        position: event.winners.length + index + 1,
        giftId: event.prizes[event.winners.length + index]?.giftId || 'delicious_cake',
        giftSent: false,
      }))

      event.winners.push(...newWinners)
      await event.save()

      // Send gifts to Second Chance winners
      const giftsToSend = newWinners.map((w) => ({
        telegramId: w.telegramId,
        giftId: w.giftId,
        position: w.position,
      }))

      const result = await GiftsService.sendGiftsToWinners(giftsToSend)

      console.log(`✅ Second Chance completed: ${result.success} gifts sent, ${result.failed} failed`)

      // Update gift sent status
      const startIndex = event.winners.length - newWinners.length
      for (let i = 0; i < newWinners.length; i++) {
        if (i < result.success) {
          event.winners[startIndex + i].giftSent = true
        }
      }

      await event.save()
    } catch (error) {
      console.error(`Failed to run Second Chance draw for event ${eventId}:`, error)
    }
  }

  /**
   * Manually trigger event completion (for testing or admin action)
   */
  static async completeEventManually(eventId: string) {
    return this.completeEvent(eventId)
  }
}
