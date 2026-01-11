import mongoose, { Schema, Document } from 'mongoose'

export interface IUser extends Document {
  telegramId: number
  username?: string
  firstName?: string
  lastName?: string
  plan: 'free' | 'trial' | 'basic' | 'advanced' | 'premium'
  planExpiresAt?: Date
  eventsCreated: number
  eventsThisMonth: number
  referralCode: string
  referredBy?: string
  referralsCount: number
  isAdmin?: boolean
  userRole: 'admin' | 'user' // admin = creates events, user = participates only
  hasUsedDemo: boolean // Track if demo event was used
  tonWalletAddress?: string // TON wallet for receiving prizes
  createdAt: Date
  updatedAt: Date
}

const UserSchema = new Schema<IUser>({
  telegramId: { type: Number, required: true, unique: true, index: true },
  username: { type: String },
  firstName: { type: String },
  lastName: { type: String },
  plan: { type: String, enum: ['free', 'trial', 'basic', 'advanced', 'premium'], default: 'free' },
  planExpiresAt: { type: Date },
  eventsCreated: { type: Number, default: 0 },
  eventsThisMonth: { type: Number, default: 0 },
  referralCode: { type: String, unique: true, index: true },
  referredBy: { type: String, index: true },
  referralsCount: { type: Number, default: 0 },
  isAdmin: { type: Boolean, default: false },
  userRole: { type: String, enum: ['admin', 'user'], default: 'user', index: true },
  hasUsedDemo: { type: Boolean, default: false },
  tonWalletAddress: { type: String, index: true },
}, { timestamps: true })

// Index for admin queries and analytics
UserSchema.index({ plan: 1, createdAt: -1 })

// Generate referral code on save
UserSchema.pre('save', function() {
  if (!this.referralCode) {
    this.referralCode = `unic_${this.telegramId}`
  }
})

export const User = mongoose.model<IUser>('User', UserSchema)
