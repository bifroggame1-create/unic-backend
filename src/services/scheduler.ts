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

    // Then run every minute
    this.intervalId = setInterval(() => {
      this.processEvents()
    }, 60 * 1000) // Every 60 seconds
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
    } catch (error) {
      console.error(`Failed to complete event ${eventId}:`, error)
    }
  }

  /**
   * Manually trigger event completion (for testing or admin action)
   */
  static async completeEventManually(eventId: string) {
    return this.completeEvent(eventId)
  }
}
