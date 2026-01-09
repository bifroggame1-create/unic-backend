import { Types } from 'mongoose'

/**
 * Security validation utilities
 */

/**
 * Validate MongoDB ObjectId
 */
export function isValidObjectId(id: string): boolean {
  return Types.ObjectId.isValid(id)
}

/**
 * Validate and parse user ID
 */
export function validateUserId(userId: string | undefined): number | null {
  if (!userId) return null

  const parsed = parseInt(userId, 10)
  if (isNaN(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

/**
 * Validate event ID parameter
 */
export function validateEventId(id: string): { valid: boolean; error?: string } {
  if (!id) {
    return { valid: false, error: 'Event ID is required' }
  }

  if (!isValidObjectId(id)) {
    return { valid: false, error: 'Invalid event ID format' }
  }

  return { valid: true }
}

/**
 * Sanitize string input (prevent XSS, injection)
 */
export function sanitizeString(input: string): string {
  if (!input) return ''

  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .slice(0, 500) // Limit length
}

/**
 * Validate pagination parameters
 */
export function validatePagination(limit?: string, offset?: string): {
  limit: number
  offset: number
} {
  const parsedLimit = parseInt(limit || '50', 10)
  const parsedOffset = parseInt(offset || '0', 10)

  return {
    limit: Math.max(1, Math.min(parsedLimit, 100)), // Clamp between 1-100
    offset: Math.max(0, parsedOffset),
  }
}

/**
 * Validate Telegram user ID
 */
export function isValidTelegramId(id: number): boolean {
  return Number.isInteger(id) && id > 0 && id < Number.MAX_SAFE_INTEGER
}

/**
 * Validate boost type
 */
export function isValidBoostType(type: string): type is 'x2_24h' | 'x1.5_forever' {
  return type === 'x2_24h' || type === 'x1.5_forever'
}

/**
 * Validate event duration
 */
export function isValidDuration(duration: string): duration is '24h' | '48h' | '72h' | '7d' {
  return ['24h', '48h', '72h', '7d'].includes(duration)
}

/**
 * Validate activity type
 */
export function isValidActivityType(type: string): type is 'reactions' | 'comments' | 'all' {
  return ['reactions', 'comments', 'all'].includes(type)
}

/**
 * Validate winners count
 */
export function isValidWinnersCount(count: number): boolean {
  return Number.isInteger(count) && count >= 1 && count <= 100
}
