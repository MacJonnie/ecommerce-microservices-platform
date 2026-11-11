
import mongoose from "mongoose";

// Schema for tracking checkout operations.
// Supports idempotency, checkout progress, and recovery.
const checkoutAttemptSchema = new mongoose.Schema(
  {
    // Customer initiating the checkout.
    userId: {
      type: String,
      required: true,
    },

    // Unique key supplied by the client for checkout idempotency.
    idempotencyKey: {
      type: String,
      required: true,
    },

    // Hash of the original checkout request.
    // Used to detect conflicting requests with the same key.
    requestHash: {
      type: String,
      required: true,
    },

    // Identifier for the inventory reservation.
    reservationId: {
      type: String,
      required: true,
    },

    // Cart revision captured during checkout.
    // Null until the cart has been retrieved.
    cartRevision: {
      type: Number,
      default: null,
    },

    // Products and quantities included in the inventory reservation.
    reservationItems: {
      type: Array,
      default: [],
    },

    // Order created by this checkout attempt.
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // Current state of the checkout operation.
    state: {
      type: String,
      enum: [
        "started",
        "reserved",
        "order_created",
        "completed",
        "compensation_pending",
        "failed",
        "cart_changed",
      ],
      default: "started",
    },

    // Error information from the most recent failed operation.
    lastError: {
      type: String,
      default: null,
    },

    // Number of recovery attempts performed.
    attempts: {
      type: Number,
      default: 0,
    },

    // Time when the next recovery attempt should run.
    nextAttemptAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    // Automatically maintain createdAt and updatedAt.
    timestamps: true,
  }
);

// Prevent duplicate checkout attempts for the same user and key.
checkoutAttemptSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    name: "uniq_checkout_user_key",
  }
);

// Supports efficient retrieval of checkout attempts
// requiring reconciliation or recovery.
checkoutAttemptSchema.index(
  { state: 1, nextAttemptAt: 1 },
  { name: "checkout_recovery_scan" }
);

// Export the CheckoutAttempt model.
export default mongoose.model(
  "CheckoutAttempt",
  checkoutAttemptSchema
);
