import mongoose, { Schema, Document, Types } from 'mongoose'

export interface ISecondChanceEntry extends Document {
  userId: number
  eventId: Types.ObjectId
  paymentId: string
  isWinner: boolean
  createdAt: Date
  updatedAt: Date
}

const SecondChanceEntrySchema = new Schema<ISecondChanceEntry>({
  userId: { type: Number, required: true, index: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
  paymentId: { type: String, required: true, unique: true },
  isWinner: { type: Boolean, default: false },
}, { timestamps: true })

// Compound index for finding entries by event
SecondChanceEntrySchema.index({ eventId: 1, isWinner: 1 })

// Unique constraint: one entry per user per event
SecondChanceEntrySchema.index({ userId: 1, eventId: 1 }, { unique: true })

export const SecondChanceEntry = mongoose.model<ISecondChanceEntry>('SecondChanceEntry', SecondChanceEntrySchema)
