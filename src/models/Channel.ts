import mongoose, { Schema, Document } from 'mongoose'

export interface IChannel extends Document {
  chatId: number
  username?: string
  title: string
  ownerId: number // telegram user id
  isVerified: boolean
  subscribersCount?: number
  addedAt: Date
  updatedAt: Date
}

const ChannelSchema = new Schema<IChannel>({
  chatId: { type: Number, required: true, unique: true, index: true },
  username: { type: String },
  title: { type: String, required: true },
  ownerId: { type: Number, required: true, index: true },
  isVerified: { type: Boolean, default: false },
  subscribersCount: { type: Number },
}, { timestamps: { createdAt: 'addedAt', updatedAt: 'updatedAt' } })

export const Channel = mongoose.model<IChannel>('Channel', ChannelSchema)
