export {
  Role,
  UserStatus,
  EntityStatus,
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  LedgerType,
  NotificationType,
  ItemKind,
} from '../../../generated/prisma/enums';

export enum PaymentProviderName {
  STRIPE = 'STRIPE',
  PAYPAL = 'PAYPAL',
  BINANCE_PAY = 'BINANCE_PAY',
  LEMON_SQUEEZY = 'LEMON_SQUEEZY',
  NOW_PAYMENTS = 'NOW_PAYMENTS',
  BITPAY = 'BITPAY',
}

export enum RefundReason {
  DUPLICATE = 'DUPLICATE',
  DEFECTIVE = 'DEFECTIVE',
  NOT_AS_DESCRIBED = 'NOT_AS_DESCRIBED',
  REQUESTED_BY_CUSTOMER = 'REQUESTED_BY_CUSTOMER',
  CHARGEBACK = 'CHARGEBACK',
  OTHER = 'OTHER',
}

export enum ConversationParticipantRole {
  BUYER = 'BUYER',
  SELLER = 'SELLER',
  SUPPORT = 'SUPPORT',
}
