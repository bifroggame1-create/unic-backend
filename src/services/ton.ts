import { mnemonicToWalletKey } from '@ton/crypto'
import { TonClient, WalletContractV4, internal, toNano, Address, fromNano } from '@ton/ton'

/**
 * TON Blockchain Service
 *
 * Handles TON transfers for prize distribution
 * Uses TON wallet configured via environment variables
 */
export class TONService {
  private static client: TonClient
  private static walletKey: { publicKey: Buffer; secretKey: Buffer } | null = null
  private static walletContract: WalletContractV4 | null = null

  /**
   * Initialize TON client and wallet
   */
  private static async init() {
    if (this.client && this.walletContract) {
      return
    }

    const network = process.env.TON_NETWORK || 'testnet'
    const mnemonic = process.env.TON_WALLET_MNEMONIC

    if (!mnemonic) {
      throw new Error('TON_WALLET_MNEMONIC not configured in environment')
    }

    // Initialize client
    this.client = new TonClient({
      endpoint: network === 'mainnet'
        ? 'https://toncenter.com/api/v2/jsonRPC'
        : 'https://testnet.toncenter.com/api/v2/jsonRPC',
      apiKey: process.env.TON_API_KEY
    })

    // Generate wallet from mnemonic
    const mnemonicArray = mnemonic.split(' ')
    this.walletKey = await mnemonicToWalletKey(mnemonicArray)

    // Create wallet contract
    this.walletContract = WalletContractV4.create({
      workchain: 0,
      publicKey: this.walletKey.publicKey
    })
  }

  /**
   * Transfer TON to recipient address
   */
  static async transferTON(recipientAddress: string, amount: number, memo?: string): Promise<boolean> {
    try {
      await this.init()

      if (!this.walletContract || !this.walletKey) {
        throw new Error('Wallet not initialized')
      }

      // Validate recipient address
      let address: Address
      try {
        address = Address.parse(recipientAddress)
      } catch (error) {
        throw new Error(`Invalid TON address: ${recipientAddress}`)
      }

      // Get wallet instance
      const wallet = this.client.open(this.walletContract)

      // Create transfer
      const seqno = await wallet.getSeqno()
      await wallet.sendTransfer({
        seqno,
        secretKey: this.walletKey.secretKey,
        messages: [
          internal({
            to: address,
            value: toNano(amount.toString()),
            body: memo || 'UNIC Prize',
            bounce: false
          })
        ]
      })

      // Wait for transaction confirmation
      let currentSeqno = seqno
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        currentSeqno = await wallet.getSeqno()
        if (currentSeqno > seqno) {
          return true
        }
      }

      throw new Error('Transaction confirmation timeout')
    } catch (error) {
      console.error('TON transfer failed:', error)
      throw error
    }
  }

  /**
   * Validate TON address format
   */
  static validateAddress(address: string): boolean {
    try {
      Address.parse(address)
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Get wallet balance
   */
  static async getBalance(): Promise<string> {
    try {
      await this.init()

      if (!this.walletContract) {
        throw new Error('Wallet not initialized')
      }

      const wallet = this.client.open(this.walletContract)
      const balance = await wallet.getBalance()

      return fromNano(balance)
    } catch (error) {
      console.error('Failed to get balance:', error)
      throw error
    }
  }

  /**
   * Estimate transfer fee
   */
  static async estimateFee(amount: number): Promise<string> {
    // TON transfer fees are typically around 0.01-0.02 TON
    // For simplicity, return a fixed estimate
    return '0.015'
  }

  /**
   * Get wallet address
   */
  static async getWalletAddress(): Promise<string> {
    try {
      await this.init()

      if (!this.walletContract) {
        throw new Error('Wallet not initialized')
      }

      return this.walletContract.address.toString()
    } catch (error) {
      console.error('Failed to get wallet address:', error)
      throw error
    }
  }

  /**
   * Check if wallet is configured
   */
  static isConfigured(): boolean {
    return !!process.env.TON_WALLET_MNEMONIC
  }
}
