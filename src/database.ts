import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/unic'

export async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI)
    console.log('✅ Connected to MongoDB')
  } catch (error) {
    console.error('❌ MongoDB connection error:', error)
    process.exit(1)
  }
}

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected')
})

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB error:', err)
})
