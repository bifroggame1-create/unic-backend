/**
 * Rate Limiting Middleware
 *
 * Prevents abuse by limiting:
 * - Comments: 10 per hour per user
 * - Events creation: 5 per day per user
 * - API calls: 100 per minute per user
 */

// In-memory store (use Redis in production for multi-instance)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

interface RateLimitConfig {
  windowMs: number  // Time window in milliseconds
  maxRequests: number  // Max requests per window
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  comments: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10
  },
  events: {
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    maxRequests: 5
  },
  api: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100
  }
}

/**
 * Check if user is rate limited
 * @returns true if within limit, false if exceeded
 */
export function checkRateLimit(
  userId: number,
  action: 'comments' | 'events' | 'api'
): { allowed: boolean; remaining: number; resetIn: number } {
  const config = RATE_LIMITS[action]
  const key = `${action}:${userId}`
  const now = Date.now()

  let record = rateLimitStore.get(key)

  // Reset if window expired
  if (!record || now >= record.resetAt) {
    record = {
      count: 0,
      resetAt: now + config.windowMs
    }
  }

  const remaining = config.maxRequests - record.count
  const resetIn = Math.max(0, record.resetAt - now)

  if (record.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetIn }
  }

  // Increment count
  record.count++
  rateLimitStore.set(key, record)

  return { allowed: true, remaining: remaining - 1, resetIn }
}

/**
 * Get current rate limit status without incrementing
 */
export function getRateLimitStatus(
  userId: number,
  action: 'comments' | 'events' | 'api'
): { remaining: number; resetIn: number } {
  const config = RATE_LIMITS[action]
  const key = `${action}:${userId}`
  const now = Date.now()

  const record = rateLimitStore.get(key)

  if (!record || now >= record.resetAt) {
    return { remaining: config.maxRequests, resetIn: config.windowMs }
  }

  return {
    remaining: Math.max(0, config.maxRequests - record.count),
    resetIn: Math.max(0, record.resetAt - now)
  }
}

/**
 * Clean up expired entries (call periodically)
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now()
  for (const [key, record] of rateLimitStore.entries()) {
    if (now >= record.resetAt) {
      rateLimitStore.delete(key)
    }
  }
}

// Cleanup every 5 minutes
setInterval(cleanupRateLimitStore, 5 * 60 * 1000)
