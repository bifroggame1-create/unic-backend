import mongoose, { Schema, Document } from 'mongoose'

export interface IGiftPool extends Document {
  giftId: string
  name: string
  sticker: any
  stars: number
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  limited: boolean
  totalAvailable: number
  reserved: number
  used: number
  convertStars: number
  requirePremium: boolean
  createdAt: Date
  updatedAt: Date
}

const GiftPoolSchema = new Schema<IGiftPool>({
  giftId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  sticker: { type: Schema.Types.Mixed },
  stars: { type: Number, required: true, min: 0 },
  rarity: {
    type: String,
    enum: ['common', 'rare', 'epic', 'legendary'],
    default: 'common'
  },
  limited: { type: Boolean, default: false },
  totalAvailable: { type: Number, required: true, min: 0, default: 0 },
  reserved: { type: Number, default: 0, min: 0 },
  used: { type: Number, default: 0, min: 0 },
  convertStars: { type: Number, required: true, min: 0 },
  requirePremium: { type: Boolean, default: false }
}, { timestamps: true })

// Index for efficient queries by rarity and price
GiftPoolSchema.index({ rarity: 1, stars: 1 })

// Index for checking availability (for pool reservation queries)
GiftPoolSchema.index({ totalAvailable: 1, reserved: 1, used: 1 })

// Validate that reserved + used doesn't exceed totalAvailable
GiftPoolSchema.pre('save', function() {
  if (this.reserved + this.used > this.totalAvailable) {
    throw new Error('Reserved + used gifts cannot exceed total available gifts')
  }
  if (this.reserved < 0 || this.used < 0) {
    throw new Error('Reserved and used counts must be non-negative')
  }
})

export const GiftPool = mongoose.model<IGiftPool>('GiftPool', GiftPoolSchema)
