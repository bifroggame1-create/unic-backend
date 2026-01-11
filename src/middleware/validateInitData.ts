import { FastifyRequest, FastifyReply } from 'fastify'
import crypto from 'crypto'
import { sendError, ErrorMessages } from '../utils/errors'

interface InitDataParsed {
  auth_date: number
  hash: string
  user?: {
    id: number
    first_name: string
    last_name?: string
    username?: string
  }
  [key: string]: any
}

/**
 * Validate Telegram WebApp initData to prevent user ID spoofing
 *
 * How it works:
 * 1. Client sends initData from Telegram.WebApp.initData
 * 2. Server verifies HMAC signature using bot token
 * 3. Checks timestamp to prevent replay attacks
 *
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export async function validateInitData(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Skip validation for webhook endpoints (they have their own validation)
  if (request.url.startsWith('/webhook')) {
    return
  }

  // Skip validation for health check and info endpoints
  if (request.url === '/health' || request.url === '/webhook/info' || request.url === '/webhook/setup') {
    return
  }

  const initData = request.headers['x-telegram-init-data'] as string | undefined
  const botToken = process.env.BOT_TOKEN

  if (!botToken) {
    request.log.error('BOT_TOKEN not configured - cannot validate initData')
    return sendError(reply, 500, ErrorMessages.INTERNAL_ERROR, 'Server configuration error')
  }

  // For MVP: Allow requests without initData (backward compatibility)
  // TODO: Make this required after frontend integration
  if (!initData) {
    request.log.warn({ url: request.url }, 'Request without initData - validation skipped')
    return
  }

  try {
    // Parse initData query string
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')

    if (!hash) {
      return sendError(reply, 401, ErrorMessages.INVALID_INIT_DATA, 'Missing hash')
    }

    // Remove hash from params for validation
    params.delete('hash')

    // Sort params alphabetically and create data check string
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    // Create secret key using bot token
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest()

    // Calculate hash
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex')

    // Verify hash matches
    if (calculatedHash !== hash) {
      return sendError(reply, 401, ErrorMessages.INVALID_INIT_DATA, 'Invalid signature')
    }

    // Check timestamp to prevent replay attacks (valid for 24 hours)
    const authDate = parseInt(params.get('auth_date') || '0')
    const now = Math.floor(Date.now() / 1000)
    const maxAge = 24 * 60 * 60 // 24 hours

    if (now - authDate > maxAge) {
      return sendError(reply, 401, ErrorMessages.INVALID_INIT_DATA, 'initData expired')
    }

    // Parse user data
    const userJson = params.get('user')
    if (userJson) {
      try {
        const user = JSON.parse(userJson)

        // Attach validated user to request for use in handlers
        // initData is the source of truth for user identity (prevents ID spoofing)
        ;(request as any).telegramUser = user
      } catch (error) {
        return sendError(reply, 401, ErrorMessages.INVALID_INIT_DATA, 'Invalid user data')
      }
    }

    request.log.debug({ userId: (request as any).telegramUser?.id }, 'initData validated')
  } catch (error: any) {
    request.log.error({ error, initData: initData.substring(0, 50) }, 'initData validation error')
    return sendError(reply, 401, ErrorMessages.INVALID_INIT_DATA, error.message)
  }
}

/**
 * Optional: Create a stricter version that always requires initData
 * Use this when frontend is updated to send initData
 */
export async function validateInitDataStrict(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Skip validation for webhook endpoints
  if (request.url.startsWith('/webhook')) {
    return
  }

  // Skip validation for health check and info endpoints
  if (request.url === '/health' || request.url === '/webhook/info' || request.url === '/webhook/setup') {
    return
  }

  const initData = request.headers['x-telegram-init-data'] as string | undefined

  if (!initData) {
    return sendError(reply, 401, ErrorMessages.INVALID_INIT_DATA, 'Missing Telegram initData')
  }

  return validateInitData(request, reply)
}
