
import mongoose from "mongoose";

// Schema for individual order items.
// These fields are immutable to preserve the original product snapshot.
const itemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    name: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: 200,
    },
    sku: {
      type: String,
      default: null,
      immutable: true,
      maxlength: 100,
    },
    // Unit price must be a non-negative safe integer.
    unitPrice: {
      type: Number,
      required: true,
      immutable: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    // Quantity must be a positive integer.
    quantity: {
      type: Number,
      required: true,
      immutable: true,
      min: 1,
      validate: Number.isInteger,
    },
    imageUrl: {
      type: String,
      default: null,
      immutable: true,
      maxlength: 2048,
    },
  },
  { _id: false }
);

// Schema for the shipping address attached to an order.
const addressSchema = new mongoose.Schema(
  {
    recipientName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30,
    },
    line1: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    line2: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    city: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    state: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    country: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    postalCode: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },
  },
  { _id: false }
);

// Main Order schema.
const orderSchema = new mongoose.Schema(
  {
    // Reference to the customer who placed the order.
    userId: {
      type: String,
      required: true,
      immutable: true,
    },

    // Product snapshots at checkout.
    // Prevents subsequent product changes from affecting existing orders.
    items: {
      type: [itemSchema],
      required: true,
      immutable: true,
      validate: (v) => v.length > 0,
    },

    // Total order amount stored as an integer.
    subtotal: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
      validate: Number.isSafeInteger,
    },

    // Currency supported by this application.
    currency: {
      type: String,
      enum: ["NGN"],
      default: "NGN",
      immutable: true,
    },

    // Shipping details captured when the order was created.
    shippingAddress: {
      type: addressSchema,
      required: true,
      immutable: true,
    },

    // Inventory reservation associated with this order.
    reservationId: {
      type: String,
      required: true,
      immutable: true,
    },

    // Used to prevent duplicate checkout requests.
    idempotencyKey: {
      type: String,
      required: true,
      immutable: true,
    },

    // Cart revision used during checkout.
    cartRevision: {
      type: Number,
      required: true,
      immutable: true,
      min: 0,
    },

    // Current order lifecycle status.
    status: {
      type: String,
      enum: [
        "pending",
        "cancellation_pending",
        "cancelled",
        "processing",
        "shipped",
        "delivered",
      ],
      default: "pending",
    },

    // Optional explanation for order cancellation.
    cancellationReason: {
      type: String,
      maxlength: 500,
    },

    // Timestamp indicating when reserved inventory was released.
    stockReleasedAt: {
      type: Date,
      default: null,
    },
  },
  {
    // Automatically maintain createdAt and updatedAt.
    timestamps: true,

    // Mongoose document version key.
    versionKey: "__v",

    // Detect concurrent document modifications.
    optimisticConcurrency: true,
  }
);

// Prevent duplicate orders for the same user and idempotency key.
orderSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $type: "string" },
    },
    name: "uniq_order_user_idempotency",
  }
);

// Efficiently retrieve a user's orders, newest first.
orderSchema.index(
  { userId: 1, createdAt: -1 },
  { name: "user_orders_newest" }
);

// Supports scanning orders requiring recovery.
orderSchema.index(
  { status: 1, updatedAt: 1 },
  { name: "order_recovery_scan" }
);

// Ensure each inventory reservation belongs to only one order.
orderSchema.index(
  { reservationId: 1 },
  { unique: true, name: "uniq_order_reservation" }
);

// Export the Order model.
export default mongoose.model("Order", orderSchema);
