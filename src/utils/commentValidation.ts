/**
 * Anti-spam validation for comments
 * Prevents users from farming points with meaningless comments
 */

interface ValidationResult {
  isValid: boolean
  reason?: string
}

/**
 * Validates comment quality to prevent spam
 * Rules:
 * - Minimum 3 words (Russian or English)
 * - Not just repeated characters
 * - Not just dots, symbols, or emojis
 * - Reasonable length (not too long to prevent copy-paste spam)
 */
export function validateComment(text: string): ValidationResult {
  if (!text || typeof text !== 'string') {
    return { isValid: false, reason: 'Empty comment' }
  }

  // Trim whitespace
  const trimmed = text.trim()

  // Minimum length check (at least 10 characters)
  if (trimmed.length < 10) {
    return { isValid: false, reason: 'Comment too short' }
  }

  // Maximum length check (prevent copy-paste spam)
  if (trimmed.length > 1000) {
    return { isValid: false, reason: 'Comment too long' }
  }

  // Remove emojis and symbols to check meaningful text
  const textOnly = trimmed.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // Remove all non-letter, non-number, non-space chars
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()

  // After removing emojis/symbols, must have at least some text
  if (textOnly.length < 5) {
    return { isValid: false, reason: 'Comment contains no meaningful text' }
  }

  // Count words (Russian and English)
  const words = textOnly.split(/\s+/).filter(word => word.length >= 2)

  if (words.length < 3) {
    return { isValid: false, reason: 'Comment must contain at least 3 words' }
  }

  // Check for repeated characters (e.g., "aaaaaaa", "........")
  const hasRepeatedChars = /(.)\1{4,}/.test(trimmed)
  if (hasRepeatedChars) {
    return { isValid: false, reason: 'Comment contains repeated characters' }
  }

  // Check if all words are the same (e.g., "good good good good")
  const uniqueWords = new Set(words.map(w => w.toLowerCase()))
  if (uniqueWords.size === 1 && words.length > 2) {
    return { isValid: false, reason: 'Comment repeats the same word' }
  }

  // Common spam patterns (Russian and English)
  const spamPatterns = [
    /^(пп|pp|up|топ|top|\+\+|--|\.\.\.)$/i,
    /^(nice|good|ok|да|нет|yes|no)$/i,
  ]

  const isJustSpam = spamPatterns.some(pattern => pattern.test(textOnly.toLowerCase()))
  if (isJustSpam && words.length < 5) {
    return { isValid: false, reason: 'Comment is too generic' }
  }

  return { isValid: true }
}

/**
 * Check if user is spamming based on recent activity
 * Prevents rapid-fire comment spam
 */
export function isCommentSpam(userId: number, eventId: string, recentComments: Date[], cooldownMs: number = 30000): boolean {
  // Check if user posted too many comments in short time
  const now = Date.now()
  const recentCount = recentComments.filter(timestamp =>
    now - timestamp.getTime() < cooldownMs
  ).length

  // Max 3 comments per 30 seconds
  return recentCount >= 3
}

export default { validateComment, isCommentSpam }
