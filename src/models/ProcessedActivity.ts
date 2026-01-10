import mongoose, { Schema, Document } from 'mongoose'

export interface IProcessedActivity extends Document {
  userId: number
  channelId: number
  messageId: number
  activityType: 'reaction' | 'comment'
  processedAt: Date
}

const ProcessedActivitySchema = new Schema<IProcessedActivity>({
  userId: { type: Number, required: true },
  channelId: { type: Number, required: true },
  messageId: { type: Number, required: true },
  activityType: { type: String, enum: ['reaction', 'comment'], required: true },
  processedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: false })

// Unique compound index to prevent duplicate processing
ProcessedActivitySchema.index(
  { userId: 1, channelId: 1, messageId: 1, activityType: 1 },
  { unique: true }
)

// TTL index: auto-delete records after 7 days (604800 seconds)
ProcessedActivitySchema.index({ processedAt: 1 }, { expireAfterSeconds: 604800 })

export const ProcessedActivity = mongoose.model<IProcessedActivity>('ProcessedActivity', ProcessedActivitySchema)
