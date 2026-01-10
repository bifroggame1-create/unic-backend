import mongoose, { Schema, Document, Types } from 'mongoose'

export interface IEvent extends Document {
  channelId: number
  ownerId: number
  title?: string
  status: 'draft' | 'pending_payment' | 'active' | 'completed' | 'cancelled'
  eventType: 'public' | 'premium'
  duration: '24h' | '48h' | '72h' | '7d'
  activityType: 'reactions' | 'comments' | 'all'
  winnersCount: number
  minParticipants?: number
  startsAt?: Date
  endsAt?: Date
  participantsCount: number
  totalReactions: number
  totalComments: number
  prizes: {
    giftId: string
    name: string
    position: number
    value?: number
  }[]
  winners: {
    telegramId: number
    username?: string
    points: number
    position: number
    giftSent: boolean
  }[]
  boostsEnabled: boolean
  packageId?: string
  postMessageId?: number
  paymentId?: string
  pricePaid?: number
  createdAt: Date
  updatedAt: Date
}

const EventSchema = new Schema<IEvent>({
  channelId: { type: Number, required: true, index: true },
  ownerId: { type: Number, required: true, index: true },
  title: { type: String },
  status: {
    type: String,
    enum: ['draft', 'pending_payment', 'active', 'completed', 'cancelled'],
    default: 'draft'
  },
  eventType: {
    type: String,
    enum: ['public', 'premium'],
    default: 'public'
  },
  duration: {
    type: String,
    enum: ['24h', '48h', '72h', '7d'],
    required: true
  },
  activityType: {
    type: String,
    enum: ['reactions', 'comments', 'all'],
    default: 'all'
  },
  winnersCount: { type: Number, required: true, min: 1, max: 100 },
  minParticipants: { type: Number, min: 0, default: 0 },
  startsAt: { type: Date },
  endsAt: { type: Date },
  participantsCount: { type: Number, default: 0 },
  totalReactions: { type: Number, default: 0 },
  totalComments: { type: Number, default: 0 },
  prizes: [{
    giftId: { type: String },
    name: { type: String },
    position: { type: Number },
    value: { type: Number }
  }],
  winners: [{
    telegramId: { type: Number },
    username: { type: String },
    points: { type: Number },
    position: { type: Number },
    giftSent: { type: Boolean, default: false }
  }],
  boostsEnabled: { type: Boolean, default: true },
  packageId: { type: String },
  postMessageId: { type: Number },
  paymentId: { type: String },
  pricePaid: { type: Number },
}, { timestamps: true })

// Index for finding active events that are ending soon
EventSchema.index({ status: 1, endsAt: 1 })

// Index for user's events dashboard queries
EventSchema.index({ ownerId: 1, status: 1, createdAt: -1 })

export const Event = mongoose.model<IEvent>('Event', EventSchema)
