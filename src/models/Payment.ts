import mongoose, { Schema, Document, Types } from 'mongoose'

export interface IPayment extends Document {
  userId: number
  eventId?: Types.ObjectId
  type: 'event_package' | 'boost'
  amount: number
  currency: 'RUB' | 'STARS'
  status: 'pending' | 'success' | 'failed' | 'refunded'
  telegramPaymentId?: string
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

const PaymentSchema = new Schema<IPayment>({
  userId: { type: Number, required: true, index: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'Event' },
  type: {
    type: String,
    enum: ['event_package', 'boost'],
    required: true,
    index: true
  },
  amount: { type: Number, required: true },
  currency: {
    type: String,
    enum: ['RUB', 'STARS'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'refunded'],
    default: 'pending',
    index: true
  },
  telegramPaymentId: { type: String, unique: true, sparse: true },
  metadata: { type: Schema.Types.Mixed }
}, { timestamps: true })

// Index for payment tracking
PaymentSchema.index({ telegramPaymentId: 1 })

export const Payment = mongoose.model<IPayment>('Payment', PaymentSchema)
