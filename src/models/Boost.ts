import mongoose, { Schema, Document, Types } from 'mongoose'

export interface IBoost extends Document {
  userId: number
  eventId: Types.ObjectId
  type: 'x2_24h' | 'x1.5_forever'
  multiplier: number
  starsPaid: number
  activatedAt: Date
  expiresAt?: Date
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const BoostSchema = new Schema<IBoost>({
  userId: { type: Number, required: true, index: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
  type: {
    type: String,
    enum: ['x2_24h', 'x1.5_forever'],
    required: true
  },
  multiplier: { type: Number, required: true },
  starsPaid: { type: Number, required: true },
  activatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true })

// Index for finding active boosts
BoostSchema.index({ userId: 1, eventId: 1, isActive: 1 })

export const Boost = mongoose.model<IBoost>('Boost', BoostSchema)
