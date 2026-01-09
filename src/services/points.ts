import { UserEventStats, Boost, Event } from '../models'
import { Types } from 'mongoose'

export class PointsService {
  // Points values
  private static readonly REACTION_POINTS = 1
  private static readonly COMMENT_POINTS = 3
  private static readonly REPLY_POINTS = 2

  /**
   * Award points for a reaction
   */
  static async handleReaction(
    userId: number,
    eventId: Types.ObjectId | string,
    messageId: number
  ): Promise<number> {
    // Check event is active
    const event = await Event.findOne({
      _id: eventId,
      status: 'active',
      endsAt: { $gt: new Date() }
    })

    if (!event) {
      throw new Error('Event not found or not active')
    }

    if (event.activityType !== 'reactions' && event.activityType !== 'all') {
      return 0 // Reactions not counted for this event
    }

    // Get or create user stats
    let stats = await UserEventStats.findOne({ userId, eventId })

    if (!stats) {
      stats = new UserEventStats({
        userId,
        eventId,
        points: 0,
        reactionsCount: 0,
        commentsCount: 0,
        repliesCount: 0,
        boostMultiplier: 1.0,
        lastActivityAt: new Date()
      })
    }

    // Check for active boost
    const boost = await this.getActiveBoost(userId, eventId)
    const multiplier = boost ? boost.multiplier : 1.0

    // Calculate points
    const basePoints = this.REACTION_POINTS
    const earnedPoints = Math.round(basePoints * multiplier)

    // Update stats
    stats.points += earnedPoints
    stats.reactionsCount += 1
    stats.boostMultiplier = multiplier
    stats.lastActivityAt = new Date()

    await stats.save()

    // Update event counters
    await Event.findByIdAndUpdate(eventId, {
      $inc: { totalReactions: 1 }
    })

    return earnedPoints
  }

  /**
   * Award points for a comment
   */
  static async handleComment(
    userId: number,
    eventId: Types.ObjectId | string,
    messageId: number,
    isReply: boolean = false
  ): Promise<number> {
    // Check event is active
    const event = await Event.findOne({
      _id: eventId,
      status: 'active',
      endsAt: { $gt: new Date() }
    })

    if (!event) {
      throw new Error('Event not found or not active')
    }

    if (event.activityType !== 'comments' && event.activityType !== 'all') {
      return 0
    }

    // Get or create user stats
    let stats = await UserEventStats.findOne({ userId, eventId })

    if (!stats) {
      stats = new UserEventStats({
        userId,
        eventId,
        points: 0,
        reactionsCount: 0,
        commentsCount: 0,
        repliesCount: 0,
        boostMultiplier: 1.0,
        lastActivityAt: new Date()
      })
    }

    // Check for active boost
    const boost = await this.getActiveBoost(userId, eventId)
    const multiplier = boost ? boost.multiplier : 1.0

    // Calculate points (reply = 2, comment = 3)
    const basePoints = isReply ? this.REPLY_POINTS : this.COMMENT_POINTS
    const earnedPoints = Math.round(basePoints * multiplier)

    // Update stats
    stats.points += earnedPoints
    if (isReply) {
      stats.repliesCount += 1
    } else {
      stats.commentsCount += 1
    }
    stats.boostMultiplier = multiplier
    stats.lastActivityAt = new Date()

    await stats.save()

    // Update event counters
    await Event.findByIdAndUpdate(eventId, {
      $inc: { totalComments: 1 }
    })

    return earnedPoints
  }

  /**
   * Apply boost to user
   */
  static async applyBoost(
    userId: number,
    eventId: Types.ObjectId | string,
    boostType: 'x2_24h' | 'x1.5_forever',
    starsPaid: number
  ): Promise<void> {
    // Check if user already has active boost
    const existingBoost = await Boost.findOne({
      userId,
      eventId,
      isActive: true
    })

    if (existingBoost) {
      throw new Error('User already has an active boost')
    }

    // Determine multiplier and expiry
    let multiplier: number
    let expiresAt: Date | undefined

    if (boostType === 'x2_24h') {
      multiplier = 2.0
      expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    } else {
      multiplier = 1.5
      expiresAt = undefined // Forever (until event ends)
    }

    // Create boost
    const boost = new Boost({
      userId,
      eventId,
      type: boostType,
      multiplier,
      starsPaid,
      activatedAt: new Date(),
      expiresAt,
      isActive: true
    })

    await boost.save()

    // Update user stats with new multiplier
    await UserEventStats.findOneAndUpdate(
      { userId, eventId },
      { boostMultiplier: multiplier, boostExpiresAt: expiresAt },
      { upsert: true }
    )
  }

  /**
   * Get active boost for user in event
   */
  private static async getActiveBoost(
    userId: number,
    eventId: Types.ObjectId | string
  ): Promise<{ multiplier: number } | null> {
    const boost = await Boost.findOne({
      userId,
      eventId,
      isActive: true,
      $or: [
        { expiresAt: { $exists: false } }, // Forever boost
        { expiresAt: { $gt: new Date() } }  // Not expired
      ]
    })

    if (!boost) return null

    // If expired, deactivate it
    if (boost.expiresAt && boost.expiresAt < new Date()) {
      boost.isActive = false
      await boost.save()
      return null
    }

    return { multiplier: boost.multiplier }
  }

  /**
   * Calculate leaderboard for event
   */
  static async calculateLeaderboard(
    eventId: Types.ObjectId | string,
    limit: number = 100,
    offset: number = 0
  ): Promise<any[]> {
    const leaderboard = await UserEventStats.aggregate([
      { $match: { eventId: new Types.ObjectId(eventId.toString()) } },
      { $sort: { points: -1, lastActivityAt: 1 } },
      { $skip: offset },
      { $limit: limit },
      {
        $project: {
          userId: 1,
          points: 1,
          reactionsCount: 1,
          commentsCount: 1,
          repliesCount: 1,
          boostMultiplier: 1,
          lastActivityAt: 1
        }
      }
    ])

    // Add rank
    return leaderboard.map((entry, index) => ({
      ...entry,
      rank: offset + index + 1
    }))
  }

  /**
   * Get user position in event
   */
  static async getUserPosition(
    userId: number,
    eventId: Types.ObjectId | string
  ): Promise<{ rank: number; points: number; totalParticipants: number } | null> {
    const userStats = await UserEventStats.findOne({ userId, eventId })

    if (!userStats) return null

    // Count users with more points (or same points but earlier activity)
    const rank = await UserEventStats.countDocuments({
      eventId,
      $or: [
        { points: { $gt: userStats.points } },
        {
          points: userStats.points,
          lastActivityAt: { $lt: userStats.lastActivityAt }
        }
      ]
    }) + 1

    // Total participants
    const totalParticipants = await UserEventStats.countDocuments({ eventId })

    return {
      rank,
      points: userStats.points,
      totalParticipants
    }
  }

  /**
   * Select winners when event ends
   */
  static async selectWinners(eventId: Types.ObjectId | string): Promise<any[]> {
    const event = await Event.findById(eventId)

    if (!event) {
      throw new Error('Event not found')
    }

    // Get top N users
    const winners = await UserEventStats.aggregate([
      { $match: { eventId: new Types.ObjectId(eventId.toString()) } },
      { $sort: { points: -1, lastActivityAt: 1 } },
      { $limit: event.winnersCount },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: 'telegramId',
          as: 'user'
        }
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          telegramId: '$userId',
          username: '$user.username',
          points: 1,
          position: 1
        }
      }
    ])

    // Add position numbers
    return winners.map((winner, index) => ({
      telegramId: winner.telegramId,
      username: winner.username,
      points: winner.points,
      position: index + 1,
      giftSent: false
    }))
  }
}
