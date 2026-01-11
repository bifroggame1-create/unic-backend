import mongoose, { Schema, Document, Types } from 'mongoose'

export interface IEvent extends Document {
  channelId: number
  ownerId: number
  title?: string
  status: 'draft' | 'pending_payment' | 'active' | 'completing' | 'completed' | 'cancelled'
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
    position: number
    type: 'telegram_gift' | 'ton' | 'custom'
    // Telegram Gift fields
    giftId?: string
    name?: string
    source?: 'pool' | 'on_demand'
    poolReserved?: boolean
    rarity?: 'common' | 'rare' | 'epic' | 'legendary'
    limited?: boolean
    remainingCount?: number
    // TON fields
    tonAmount?: number
    // Custom fields
    customReward?: {
      name: string
      description: string
    }
    // Display fields
    value?: number
    status?: 'pending' | 'sent' | 'failed'
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
    enum: ['draft', 'pending_payment', 'active', 'completing', 'completed', 'cancelled'],
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
    position: { type: Number, required: true },
    type: { type: String, enum: ['telegram_gift', 'ton', 'custom'], required: true },
    // Telegram Gift fields
    giftId: { type: String },
    name: { type: String },
    source: { type: String, enum: ['pool', 'on_demand'] },
    poolReserved: { type: Boolean, default: false },
    rarity: { type: String, enum: ['common', 'rare', 'epic', 'legendary'] },
    limited: { type: Boolean },
    remainingCount: { type: Number },
    // TON fields
    tonAmount: { type: Number, min: 0 },
    // Custom fields
    customReward: {
      name: { type: String },
      description: { type: String }
    },
    // Display fields
    value: { type: Number },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' }
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

// Validate dates before save
EventSchema.pre('save', function() {
  if (this.startsAt && this.endsAt && this.startsAt >= this.endsAt) {
    throw new Error('Event start date must be before end date')
  }
})

// TTL index: auto-delete completed events after 30 days
EventSchema.index(
  { status: 1, updatedAt: 1 },
  {
    partialFilterExpression: { status: 'completed' },
    expireAfterSeconds: 2592000 // 30 days
  }
)

export const Event = mongoose.model<IEvent>('Event', EventSchema)
