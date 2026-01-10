import { FastifyReply, FastifyRequest } from 'fastify'

export interface ErrorResponse {
  error: string
  message?: string
  details?: any
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public details?: any
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/**
 * Send standardized error response with logging
 */
export function sendError(
  reply: FastifyReply,
  statusCode: number,
  error: string,
  message?: string,
  details?: any
) {
  const response: ErrorResponse = {
    error,
    ...(message && { message }),
    ...(details && { details }),
  }

  // Log error with context
  if (statusCode >= 500) {
    reply.log.error({ statusCode, error, message, details }, 'Server error')
  } else if (statusCode >= 400) {
    reply.log.warn({ statusCode, error, message, details }, 'Client error')
  }

  return reply.status(statusCode).send(response)
}

/**
 * Common error responses
 */
export const ErrorMessages = {
  // Auth errors (401)
  UNAUTHORIZED: 'Unauthorized',
  INVALID_TELEGRAM_ID: 'Invalid or missing Telegram ID',
  INVALID_INIT_DATA: 'Invalid Telegram initData',

  // Forbidden errors (403)
  FORBIDDEN: 'Forbidden',
  NOT_YOUR_RESOURCE: 'You do not have permission to access this resource',
  NOT_CHANNEL_ADMIN: 'You must be an admin of this channel',
  EVENT_LIMIT_REACHED: 'Event limit reached. Upgrade your plan.',

  // Not found errors (404)
  NOT_FOUND: 'Resource not found',
  USER_NOT_FOUND: 'User not found',
  EVENT_NOT_FOUND: 'Event not found',
  CHANNEL_NOT_FOUND: 'Channel not found',
  PAYMENT_NOT_FOUND: 'Payment not found',

  // Validation errors (400)
  BAD_REQUEST: 'Bad request',
  INVALID_INPUT: 'Invalid input',
  INVALID_EVENT_ID: 'Invalid event ID format',
  INVALID_CHANNEL_ID: 'Invalid channel ID',
  INVALID_DURATION: 'Invalid duration. Must be 24h, 48h, 72h, or 7d',
  INVALID_ACTIVITY_TYPE: 'Invalid activity type. Must be reactions, comments, or all',
  INVALID_WINNERS_COUNT: 'Winners count must be between 1 and 100',
  INVALID_PLAN_ID: 'Invalid plan ID',
  INVALID_PAYMENT_ID: 'Invalid payment ID',

  // Business logic errors (400)
  EVENT_NOT_ACTIVE: 'Event is not active',
  EVENT_NOT_PENDING: 'Event is not pending payment',
  PAYMENT_NOT_COMPLETED: 'Payment not completed',
  ALREADY_JOINED: 'Already joined this event',
  REFERRAL_ALREADY_APPLIED: 'Referral code already applied',
  INVALID_REFERRAL_CODE: 'Invalid referral code',
  CANNOT_USE_OWN_REFERRAL: 'Cannot use your own referral code',

  // Server errors (500)
  INTERNAL_ERROR: 'Internal server error',
  DATABASE_ERROR: 'Database error',
  PAYMENT_SERVICE_ERROR: 'Payment service error',
  TELEGRAM_API_ERROR: 'Telegram API error',
} as const

/**
 * Error handler for uncaught errors in async routes
 */
export function errorHandler(error: Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    return sendError(reply, error.statusCode, error.message, undefined, error.details)
  }

  // Log unexpected errors
  reply.log.error({ error, url: request.url, method: request.method }, 'Unexpected error')

  return sendError(reply, 500, ErrorMessages.INTERNAL_ERROR, error.message)
}
