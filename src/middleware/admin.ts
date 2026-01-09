import { FastifyRequest, FastifyReply } from 'fastify'
import { User } from '../models'

/**
 * Admin users - full access without limits
 * Usernames: @cheffofgang, @privetlefortovo, @v_liza_a
 */
const ADMIN_USERNAMES = ['cheffofgang', 'privetlefortovo', 'v_liza_a']

/**
 * Check if user is admin by username
 */
export async function isAdmin(telegramId: number): Promise<boolean> {
  const user = await User.findOne({ telegramId })

  if (!user || !user.username) {
    return false
  }

  // Check if username matches admin list (case insensitive)
  const username = user.username.toLowerCase().replace('@', '')
  return ADMIN_USERNAMES.includes(username)
}

/**
 * Middleware to check admin access
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const telegramId = request.headers['x-telegram-id']

  if (!telegramId) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }

  const userId = Number(telegramId)
  const adminStatus = await isAdmin(userId)

  if (!adminStatus) {
    return reply.status(403).send({ error: 'Admin access required' })
  }
}

/**
 * Grant admin privileges on user registration/update
 */
export async function grantAdminPrivileges(user: any): Promise<void> {
  if (!user.username) return

  const username = user.username.toLowerCase().replace('@', '')

  if (ADMIN_USERNAMES.includes(username)) {
    // Give admin unlimited plan
    user.plan = 'premium'
    user.planExpiresAt = new Date('2099-12-31') // Effectively unlimited
    user.isAdmin = true
  }
}
