import { Participation, Event, IEvent } from '../models'
import { Types } from 'mongoose'

// Points configuration
const POINTS = {
  reaction: 1,
  comment: 3,
  reply: 2,
}

interface ActivityData {
  telegramId: number
  username?: string
  firstName?: string
  type: 'reaction' | 'comment' | 'reply'
}

/**
 * Record user activity and update points
 */
export async function recordActivity(eventId: string | Types.ObjectId, data: ActivityData): Promise<number> {
  const points = POINTS[data.type]

  const participation = await Participation.findOneAndUpdate(
    {
      eventId: new Types.ObjectId(eventId),
      telegramId: data.telegramId,
    },
    {
      $inc: {
        points,
        [`${data.type}sCount`]: 1,
      },
      $set: {
        username: data.username,
        firstName: data.firstName,
        lastActivityAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
    }
  )

  // Update event stats
  await Event.findByIdAndUpdate(eventId, {
    $inc: {
      [`total${data.type === 'reaction' ? 'Reactions' : 'Comments'}`]: 1,
    },
  })

  return participation.points
}

/**
 * Get leaderboard for an event
 */
export async function getLeaderboard(
  eventId: string | Types.ObjectId,
  limit: number = 100,
  offset: number = 0
) {
  const participants = await Participation.find({ eventId: new Types.ObjectId(eventId) })
    .sort({ points: -1 })
    .skip(offset)
    .limit(limit)
    .lean()

  return participants.map((p, idx) => ({
    rank: offset + idx + 1,
    telegramId: p.telegramId,
    username: p.username,
    firstName: p.firstName,
    points: p.points,
    reactionsCount: p.reactionsCount,
    commentsCount: p.commentsCount,
    repliesCount: p.repliesCount,
  }))
}

/**
 * Get user's position in leaderboard
 */
export async function getUserPosition(
  eventId: string | Types.ObjectId,
  telegramId: number
) {
  const participation = await Participation.findOne({
    eventId: new Types.ObjectId(eventId),
    telegramId,
  }).lean()

  if (!participation) {
    return null
  }

  // Count how many participants have more points
  const higherRanked = await Participation.countDocuments({
    eventId: new Types.ObjectId(eventId),
    points: { $gt: participation.points },
  })

  return {
    rank: higherRanked + 1,
    points: participation.points,
    reactionsCount: participation.reactionsCount,
    commentsCount: participation.commentsCount,
    repliesCount: participation.repliesCount,
  }
}

/**
 * Get total participants count
 */
export async function getParticipantsCount(eventId: string | Types.ObjectId): Promise<number> {
  return Participation.countDocuments({ eventId: new Types.ObjectId(eventId) })
}

/**
 * Finalize event and determine winners
 */
export async function finalizeEvent(eventId: string | Types.ObjectId): Promise<void> {
  const event = await Event.findById(eventId)
  if (!event) throw new Error('Event not found')

  // Get top participants
  const winners = await Participation.find({ eventId: new Types.ObjectId(eventId) })
    .sort({ points: -1 })
    .limit(event.winnersCount)
    .lean()

  // Update event with winners
  event.winners = winners.map((w, idx) => ({
    telegramId: w.telegramId,
    username: w.username,
    points: w.points,
    position: idx + 1,
    giftSent: false,
  }))
  event.status = 'completed'
  event.participantsCount = await getParticipantsCount(eventId)

  await event.save()
}
