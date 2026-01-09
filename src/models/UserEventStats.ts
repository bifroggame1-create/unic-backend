import mongoose, { Schema, Document, Types } from 'mongoose'

export interface IUserEventStats extends Document {
  userId: number
  eventId: Types.ObjectId
  points: number
  reactionsCount: number
  commentsCount: number
  repliesCount: number
  boostMultiplier: number
  boostExpiresAt?: Date
  lastActivityAt: Date
  rank?: number
  createdAt: Date
  updatedAt: Date
}

const UserEventStatsSchema = new Schema<IUserEventStats>({
  userId: { type: Number, required: true, index: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
  points: { type: Number, default: 0, index: true },
  reactionsCount: { type: Number, default: 0 },
  commentsCount: { type: Number, default: 0 },
  repliesCount: { type: Number, default: 0 },
  boostMultiplier: { type: Number, default: 1.0, min: 1.0, max: 3.0 },
  boostExpiresAt: { type: Date },
  lastActivityAt: { type: Date, default: Date.now },
  rank: { type: Number }
}, { timestamps: true })

// Compound index for fast leaderboard queries
UserEventStatsSchema.index({ eventId: 1, points: -1 })

// Unique constraint: one stat doc per user per event
UserEventStatsSchema.index({ userId: 1, eventId: 1 }, { unique: true })

export const UserEventStats = mongoose.model<IUserEventStats>('UserEventStats', UserEventStatsSchema)
