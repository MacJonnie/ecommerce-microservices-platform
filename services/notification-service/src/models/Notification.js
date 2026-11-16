import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    // Event key used to select the email template.
    event: { type: String, required: true, trim: true },

    // Customer and order identifiers are stored for audit purposes.
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    orderId: { type: String, default: null },
    paymentReference: { type: String, default: null },

    // Recipient is resolved from User Service, never trusted from request input.
    recipient: { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    message: { type: String, required: true },

    status: {
      type: String,
      enum: ["queued", "sending", "sent", "failed"],
      default: "queued",
      index: true,
    },

    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 8, min: 1 },
    lastError: { type: String, default: null, maxlength: 1000 },
    sentAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, default: Date.now, index: true },

    // Stable event key prevents duplicate emails on service retries.
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

// Efficiently find queued/retryable notifications.
notificationSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

export default mongoose.model("Notification", notificationSchema);
