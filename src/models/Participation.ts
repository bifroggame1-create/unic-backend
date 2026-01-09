import mongoose, { Schema, Document, Types } from 'mongoose'

export interface IParticipation extends Document {
  eventId: Types.ObjectId
  telegramId: number
  username?: string
  firstName?: string
  points: number
  reactionsCount: number
  commentsCount: number
  repliesCount: number
  lastActivityAt: Date
  createdAt: Date
  updatedAt: Date
}

const ParticipationSchema = new Schema<IParticipation>({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
  telegramId: { type: Number, required: true, index: true },
  username: { type: String },
  firstName: { type: String },
  points: { type: Number, default: 0 },
  reactionsCount: { type: Number, default: 0 },
  commentsCount: { type: Number, default: 0 },
  repliesCount: { type: Number, default: 0 },
  lastActivityAt: { type: Date, default: Date.now },
}, { timestamps: true })

// Compound index for efficient lookups
ParticipationSchema.index({ eventId: 1, telegramId: 1 }, { unique: true })
// Index for leaderboard sorting
ParticipationSchema.index({ eventId: 1, points: -1 })

export const Participation = mongoose.model<IParticipation>('Participation', ParticipationSchema)
