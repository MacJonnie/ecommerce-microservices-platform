
import mongoose from "mongoose";

// Define the Payment schema.
const schema = new mongoose.Schema(
  {
    // Reference to the order being paid for.
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    // Reference to the user who initiated the payment.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    // Unique Paystack transaction reference.
    reference: {
      type: String,
      required: true,
      unique: true,
    },

    // Idempotency key prevents duplicate payment initialization.
    idempotencyKey: {
      type: String,
      required: true,
    },

    // Transaction amount stored in Kobo.
    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    // Transaction currency.
    currency: {
      type: String,
      default: "NGN",
    },

    // Current payment lifecycle status.
    status: {
      type: String,
      enum: [
        "initialized",
        "pending",
        "success",
        "failed",
        "abandoned",
      ],
      default: "initialized",
      index: true,
    },

    // Paystack checkout URL used to redirect the customer.
    authorizationUrl: String,

    // Paystack authorization access code.
    accessCode: String,

    // Paystack transaction ID returned after verification.
    providerTransactionId: String,

    // Timestamp indicating when payment was confirmed.
    paidAt: Date,

    // Most recent provider or processing error (never expose to customers).
    lastError: { type: String, maxlength: 500, default: null },
  },
  {
    // Automatically maintain createdAt and updatedAt.
    timestamps: true,
  }
);

// Enforce idempotency per user.
// The same user cannot reuse an idempotency key for another payment.
schema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true }
);

// Register and export the Payment model.
export default mongoose.model("Payment", schema);
