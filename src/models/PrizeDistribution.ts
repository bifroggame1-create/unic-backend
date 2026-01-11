import mongoose, { Schema, Document, Types } from 'mongoose'

export interface IPrizeDistribution extends Document {
  eventId: Types.ObjectId
  winnerId: number
  position: number
  prizeType: 'telegram_gift' | 'ton' | 'custom'
  giftId?: string
  tonAmount?: number
  customReward?: {
    name: string
    description: string
  }
  status: 'pending' | 'processing' | 'sent' | 'failed'
  attempts: number
  lastAttemptAt?: Date
  sentAt?: Date
  error?: string
  createdAt: Date
  updatedAt: Date
}

const PrizeDistributionSchema = new Schema<IPrizeDistribution>({
  eventId: { type: Schema.Types.ObjectId, required: true, ref: 'Event', index: true },
  winnerId: { type: Number, required: true, index: true },
  position: { type: Number, required: true, min: 1 },
  prizeType: {
    type: String,
    enum: ['telegram_gift', 'ton', 'custom'],
    required: true
  },
  giftId: { type: String },
  tonAmount: { type: Number, min: 0 },
  customReward: {
    name: { type: String },
    description: { type: String }
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'sent', 'failed'],
    default: 'pending',
    index: true
  },
  attempts: { type: Number, default: 0, min: 0, max: 3 },
  lastAttemptAt: { type: Date },
  sentAt: { type: Date },
  error: { type: String }
}, { timestamps: true })

// Index for finding failed prizes that need retry
PrizeDistributionSchema.index({ status: 1, attempts: 1 })

// Index for event prize tracking queries
PrizeDistributionSchema.index({ eventId: 1, status: 1 })

// Index for user prize history queries
PrizeDistributionSchema.index({ winnerId: 1, createdAt: -1 })

// Validate prize configuration based on type
PrizeDistributionSchema.pre('save', function() {
  if (this.prizeType === 'telegram_gift' && !this.giftId) {
    throw new Error('giftId is required for telegram_gift prize type')
  }
  if (this.prizeType === 'ton' && !this.tonAmount) {
    throw new Error('tonAmount is required for ton prize type')
  }
  if (this.prizeType === 'custom' && !this.customReward?.name) {
    throw new Error('customReward.name is required for custom prize type')
  }
  if (this.attempts > 3) {
    throw new Error('Maximum 3 retry attempts allowed')
  }
})

export const PrizeDistribution = mongoose.model<IPrizeDistribution>('PrizeDistribution', PrizeDistributionSchema)
