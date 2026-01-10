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
   * MVP: Only x1.5 multiplier until event ends, 100 Stars
   */
  static async createBoostInvoice(
    userId: number,
    eventId: Types.ObjectId | string,
    amount: number = 100
  ): Promise<{ invoiceLink: string; paymentId: string }> {
    const title = 'Boost x1.5'
    const description = 'Увеличь свои шансы с множителем x1.5 до конца события'

    // Create payment record
    const payment = new Payment({
      userId,
      eventId,
      type: 'boost',
      amount,
      currency: 'STARS',
      status: 'pending',
      metadata: { multiplier: 1.5, duration: 'event' },
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
   * Create Telegram Stars invoice for Second Chance purchase
   * MVP: 75 Stars for one additional draw entry
   */
  static async createSecondChanceInvoice(
    userId: number,
    eventId: Types.ObjectId | string,
    amount: number = 75
  ): Promise<{ invoiceLink: string; paymentId: string }> {
    const title = 'Second Chance'
    const description = 'Получи дополнительный шанс в розыгрыше призов'

    // Create payment record
    const payment = new Payment({
      userId,
      eventId,
      type: 'second_chance',
      amount,
      currency: 'STARS',
      status: 'pending',
      metadata: {},
    })

    await payment.save()

    try {
      // Create Telegram Stars invoice
      const invoiceLink = await bot.api.createInvoiceLink(
        title,
        description,
        payment._id.toString(),
        '',
        'XTR',
        [{ label: title, amount }]
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
   * Create Telegram Stars invoice for plan upgrade
   */
  static async createPlanUpgradeInvoice(
    userId: number,
    planId: string,
    amount: number
  ): Promise<{ invoiceLink: string; paymentId: string }> {
    const plans: Record<string, { title: string; description: string }> = {
      trial: {
        title: 'Trial Plan',
        description: '3 events/month • 1000 participants',
      },
      basic: {
        title: 'Basic Plan',
        description: '10 events/month • 5000 participants',
      },
      advanced: {
        title: 'Advanced Plan',
        description: 'Unlimited events • 50000 participants',
      },
      premium: {
        title: 'Premium Plan',
        description: 'Unlimited events • Unlimited participants',
      },
    }

    const plan = plans[planId] || plans.basic

    // Create payment record
    const payment = new Payment({
      userId,
      type: 'plan_upgrade',
      amount,
      currency: 'STARS',
      status: 'pending',
      metadata: { planId },
    })

    await payment.save()

    try {
      // Create Telegram Stars invoice
      const invoiceLink = await bot.api.createInvoiceLink(
        plan.title,
        plan.description,
        payment._id.toString(),
        '',
        'XTR',
        [{ label: plan.title, amount }]
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
