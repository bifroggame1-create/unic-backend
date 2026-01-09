import { bot } from './telegram'
import { Payment, IPayment } from '../models'
import { Types } from 'mongoose'

/**
 * Telegram Stars Payment Service
 *
 * Handles in-app purchases using Telegram Stars for:
 * - User boosts (x2 24h, x1.5 forever)
 * - Admin event packages
 *
 * Docs: https://core.telegram.org/bots/payments-stars
 */

export class PaymentService {
  /**
   * Create Telegram Stars invoice for boost purchase
   */
  static async createBoostInvoice(
    userId: number,
    eventId: Types.ObjectId | string,
    boostType: 'x2_24h' | 'x1.5_forever'
  ): Promise<{ invoiceLink: string; paymentId: string }> {
    // Determine Stars amount
    const amount = boostType === 'x2_24h' ? 100 : 200

    const title = boostType === 'x2_24h'
      ? '2x Boost (24 hours)'
      : '1.5x Boost (Forever)'

    const description = boostType === 'x2_24h'
      ? 'Double your points for 24 hours'
      : 'Get 1.5x points multiplier until event ends'

    // Create payment record
    const payment = new Payment({
      userId,
      eventId,
      type: 'boost',
      amount,
      currency: 'STARS',
      status: 'pending',
      metadata: { boostType },
    })

    await payment.save()

    try {
      // Create Telegram Stars invoice
      const invoiceLink = await bot.api.createInvoiceLink(
        title,
        description,
        payment._id.toString(), // Payload to identify this payment
        '', // Provider token (empty for Telegram Stars)
        'XTR', // Currency: XTR for Telegram Stars
        [{ label: title, amount }] // Prices in Stars (1 unit = 1 Star)
      )

      return {
        invoiceLink,
        paymentId: payment._id.toString(),
      }
    } catch (error) {
      // Mark payment as failed
      payment.status = 'failed'
      await payment.save()
      throw error
    }
  }

  /**
   * Create Telegram Stars invoice for event package
   */
  static async createEventPackageInvoice(
    userId: number,
    eventId: Types.ObjectId | string,
    packageId: string,
    amount: number
  ): Promise<{ invoiceLink: string; paymentId: string }> {
    const packages: Record<string, { title: string; description: string }> = {
      starter: {
        title: 'Starter Package',
        description: '1 event • Up to 1000 participants',
      },
      growth: {
        title: 'Growth Package',
        description: '5 events • Up to 5000 participants',
      },
      pro: {
        title: 'Pro Package',
        description: '10 events • Up to 50000 participants',
      },
    }

    const pkg = packages[packageId] || packages.starter

    // Create payment record
    const payment = new Payment({
      userId,
      eventId,
      type: 'event_package',
      amount,
      currency: 'STARS',
      status: 'pending',
      metadata: { packageId },
    })

    await payment.save()

    try {
      // Create Telegram Stars invoice
      const invoiceLink = await bot.api.createInvoiceLink(
        pkg.title,
        pkg.description,
        payment._id.toString(),
        '',
        'XTR',
        [{ label: pkg.title, amount }]
      )

      return {
        invoiceLink,
        paymentId: payment._id.toString(),
      }
    } catch (error) {
      payment.status = 'failed'
      await payment.save()
      throw error
    }
  }

  /**
   * Handle successful payment callback from Telegram
   */
  static async handleSuccessfulPayment(
    telegramPaymentId: string,
    paymentId: string
  ): Promise<IPayment | null> {
    const payment = await Payment.findById(paymentId)

    if (!payment) {
      console.error(`Payment not found: ${paymentId}`)
      return null
    }

    if (payment.status === 'success') {
      console.log(`Payment already processed: ${paymentId}`)
      return payment
    }

    // Update payment status
    payment.status = 'success'
    payment.telegramPaymentId = telegramPaymentId
    await payment.save()

    console.log(`✅ Payment successful: ${paymentId} (${payment.amount} STARS)`)

    return payment
  }

  /**
   * Handle failed/refunded payment
   */
  static async handleFailedPayment(
    paymentId: string,
    status: 'failed' | 'refunded'
  ): Promise<void> {
    const payment = await Payment.findById(paymentId)

    if (!payment) {
      console.error(`Payment not found: ${paymentId}`)
      return
    }

    payment.status = status
    await payment.save()

    console.log(`❌ Payment ${status}: ${paymentId}`)
  }

  /**
   * Get payment by ID
   */
  static async getPayment(paymentId: string): Promise<IPayment | null> {
    return Payment.findById(paymentId)
  }

  /**
   * Get user's payment history
   */
  static async getUserPayments(
    userId: number,
    limit: number = 50
  ): Promise<IPayment[]> {
    return Payment.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
  }
}
