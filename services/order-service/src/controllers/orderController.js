
import crypto from "node:crypto";
import mongoose from "mongoose";

import Order from "../model/Order.js";
import CheckoutAttempt from "../model/CheckoutAttempt.js";

import {
  getProduct,
  reserveInventory,
  releaseInventory,
} from "../service/catalogClient.js";

import {
  getCart,
  clearCart,
} from "../service/cartClient.js";

// Required fields for a valid shipping address.
const addressFields = [
  "recipientName",
  "phone",
  "line1",
  "city",
  "state",
  "country",
  "postalCode",
];

// Validate that all required address fields are non-empty strings.
const validAddress = (v) =>
  v &&
  addressFields.every(
    (k) => typeof v[k] === "string" && v[k].trim().length > 0
  );

// Generate a SHA-256 hash for request fingerprinting.
const hash = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Compare hashes securely to prevent timing-based comparisons.
const safeEqual = (a, b) =>
  a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Normalize shipping address fields before storing or hashing.
function normalizeAddress(address) {
  const out = {};

  for (const k of [...addressFields, "line2"]) {
    if (address[k] !== undefined) {
      out[k] = String(address[k]).trim();
    }
  }

  return out;
}

// Extract product IDs and quantities from an existing order.
// Used when releasing reserved inventory during cancellation.
function reservationItemsFromOrder(order) {
  return order.items.map((i) => ({
    productId: String(i.productId),
    quantity: i.quantity,
  }));
}

// Create an order using the customer's cart.
export async function createOrder(req, res, next) {
  const userId = String(req.user.userId);

  // Read the idempotency key supplied by the client.
  const key = req.get("Idempotency-Key");

  // Require a valid idempotency key between 8 and 128 characters.
  if (
    typeof key !== "string" ||
    key.length < 8 ||
    key.length > 128 ||
    !/^[\w.:=-]+$/.test(key)
  ) {
    return res.status(400).json({
      success: false,
      message: "Provide an Idempotency-Key header (8–128 safe characters).",
    });
  }

  // Validate the shipping address supplied in the request.
  const { shippingAddress } = req.body ?? {};

  if (!validAddress(shippingAddress)) {
    return res.status(400).json({
      success: false,
      message: "A complete shippingAddress is required.",
    });
  }

  // Normalize the address and create a request fingerprint.
  const normalizedAddress = normalizeAddress(shippingAddress);
  const requestHash = hash(normalizedAddress);

  // Track checkout progress and inventory reservation state.
let attempt,
  reserved = false,
  orderCreated = false,
  cartConflict = false,
  reservationId = crypto.randomUUID(),
  reservationItems = [];

  try {
    // Create a checkout attempt for this idempotency key.
    try {
      attempt = await CheckoutAttempt.create({
        userId,
        idempotencyKey: key,
        requestHash,
        reservationId,
      });
    } catch (e) {
      // Handle duplicate idempotency keys.
      if (e.code !== 11000) throw e;

      attempt = await CheckoutAttempt.findOne({
        userId,
        idempotencyKey: key,
      });

      if (!attempt) throw e;

      // Prevent reusing a key with a different shipping address.
      if (!safeEqual(attempt.requestHash, requestHash)) {
        return res.status(409).json({
          success: false,
          message:
            "This Idempotency-Key was already used with a different shipping address.",
        });
      }

      // Find the order created by the original checkout attempt.
      const prior = attempt.orderId
        ? await Order.findById(attempt.orderId).lean()
        : await Order.findOne({ userId, idempotencyKey: key }).lean();

      // If the order already exists, return it instead of creating another.
      if (prior) {
        await CheckoutAttempt.updateOne(
          { _id: attempt._id },
          {
            $set: {
              orderId: prior._id,
              state:
                attempt.state === "reserved"
                  ? "order_created"
                  : attempt.state,
              nextAttemptAt: new Date(),
            },
          }
        );

        return res.status(200).json({
          success: true,
          message: "Idempotent checkout replay.",
          order: prior,
          cartCleared: attempt.state === "completed",
          replayed: true,
        });
      }

      // Existing attempt is still processing or requires recovery.
      return res.status(409).json({
        success: false,
        message:
          "Checkout with this Idempotency-Key is still processing or requires recovery.",
        state: attempt.state,
      });
    }

    // Retrieve the customer's current cart.
    const cart = await getCart(userId);
    const cartItems = cart.items;

    // Capture the cart revision used during checkout.
    const cartRevision = Number.isInteger(cart.revision)
      ? cart.revision
      : 0;

    // Reject checkout when the cart is empty.
    if (!cartItems.length) {
      await CheckoutAttempt.updateOne(
        { _id: attempt._id },
        { $set: { state: "failed", lastError: "Cart is empty" } }
      );

      return res.status(400).json({
        success: false,
        message: "Your cart is empty.",
      });
    }

    // Restrict the maximum number of cart entries.
    if (cartItems.length > 50) {
      throw Object.assign(
        new Error("Cart contains too many items."),
        { statusCode: 400 }
      );
    }

    // Normalize cart items by product ID.
    // This combines duplicate product entries into one quantity.
    const normalized = new Map();

    for (const item of cartItems) {
      if (
        !item ||
        !mongoose.isValidObjectId(item.productId) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 100
      ) {
        throw Object.assign(
          new Error("Your cart contains an invalid item."),
          { statusCode: 409 }
        );
      }

      const id = String(item.productId);

      normalized.set(
        id,
        (normalized.get(id) || 0) + item.quantity
      );
    }

    // Ensure combined quantities remain within the permitted limit.
    if ([...normalized.values()].some((q) => q > 100)) {
      throw Object.assign(
        new Error("Combined cart quantity cannot exceed 100."),
        { statusCode: 409 }
      );
    }

    // Fetch product details from the Catalog Service.
    // Validate product availability and price.
    const products = await Promise.all(
      [...normalized.keys()].map(async (productId) => {
        const product = await getProduct(productId);

        if (!product.isActive) {
          throw Object.assign(
            new Error(`Product ${productId} is unavailable.`),
            { statusCode: 409 }
          );
        }

        const price = Number(product.price);

        if (!Number.isSafeInteger(price) || price < 0) {
          throw new Error(
            `Catalog returned invalid integer NGN price for ${productId}.`
          );
        }

        return {
          product,
          quantity: normalized.get(productId),
        };
      })
    );

    // Create immutable product snapshots for the order.
    const items = products.map(({ product, quantity }) => ({
      productId: product._id,
      name: product.name,
      sku: product.sku ?? null,
      unitPrice: Number(product.price),
      quantity,
      imageUrl: product.images?.[0]?.url ?? null,
    }));

    // Calculate the order subtotal.
    const subtotal = items.reduce(
      (sum, i) => sum + i.unitPrice * i.quantity,
      0
    );

    // Ensure subtotal does not exceed safe integer precision.
    if (!Number.isSafeInteger(subtotal)) {
      throw Object.assign(
        new Error("Order subtotal exceeds supported money precision."),
        { statusCode: 400 }
      );
    }

    // Prepare the inventory reservation payload.
    reservationItems = items.map((i) => ({
      productId: String(i.productId),
      quantity: i.quantity,
    }));

    // Persist the cart revision and reservation items
    // before attempting inventory reservation.
    await CheckoutAttempt.updateOne(
      { _id: attempt._id },
      { $set: { cartRevision, reservationItems } }
    );

    // Reserve inventory from the Catalog Service.
    await reserveInventory(reservationId, reservationItems);
    reserved = true;

    // Record that inventory reservation succeeded.
    await CheckoutAttempt.updateOne(
      { _id: attempt._id },
      { $set: { state: "reserved" } }
    );

    // Create the order using the captured cart snapshot.
    const order = await Order.create({
      userId,
      items,
      subtotal,
      currency: "NGN",
      shippingAddress: normalizedAddress,
      reservationId,
      idempotencyKey: key,
      cartRevision,
      status: "pending",
    });

    orderCreated = true;

    // Record the newly created order in the checkout attempt.
    await CheckoutAttempt.updateOne(
      { _id: attempt._id },
      { $set: { orderId: order._id, state: "order_created" } }
    );

    // Attempt to clear only the cart revision used for checkout.
    let cartCleared = false;

    try {
      const result = await clearCart(userId, cartRevision);

      cartCleared = result.cleared === true;
    } catch (e) {
      // If the cart revision changed, preserve the newer cart.
      if (e.statusCode === 409) {
        cartCleared = false;
        cartConflict = true;
      } else {
        console.error(
          "Cart clear needs retry/reconciliation:",
          e.message
        );
      }
    }

    // Update the checkout attempt based on cart clearing outcome.
    await CheckoutAttempt.updateOne(
      { _id: attempt._id },
      {
        $set: {
          state: cartCleared
            ? "completed"
            : cartConflict
              ? "cart_changed"
              : "order_created",
          lastError: cartCleared
            ? null
            : "Cart clear pending or cart changed",
          nextAttemptAt: new Date(Date.now() + 15000),
        },
      }
    );

    // Return the successfully created order.
    return res.status(201).json({
      success: true,
      message: "Order created. Payment has not been taken.",
      order,
      cartCleared,
    });
  } catch (error) {
    // Compensate for inventory reservation if order creation failed.
    if (reserved && !orderCreated) {
      try {
        await releaseInventory(reservationId, reservationItems);

        await CheckoutAttempt.updateOne(
          { _id: attempt?._id },
          { $set: { state: "failed", lastError: error.message } }
        );
      } catch (releaseError) {
        // Persist failed compensation for background recovery.
        await CheckoutAttempt.updateOne(
          { _id: attempt?._id },
          {
            $set: {
              state: "compensation_pending",
              lastError: releaseError.message,
              nextAttemptAt: new Date(Date.now() + 5000),
            },
          }
        ).catch(() => {});

        console.error(
          "Durable inventory compensation queued",
          reservationId,
          releaseError.message
        );
      }
    } else if (attempt && !orderCreated) {
      // Record checkout failure when no order was created.
      await CheckoutAttempt.updateOne(
        { _id: attempt._id },
        { $set: { state: "failed", lastError: error.message } }
      ).catch(() => {});
    }

    // Return known application errors directly.
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    // Handle Mongoose validation errors.
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Order validation failed.",
      });
    }

    // Pass unexpected errors to centralized error middleware.
    return next(error);
  }
}

// Retrieve paginated orders.
// Admins can retrieve all orders by specifying all=true.
export async function listOrders(req, res, next) {
  try {
    const page = Math.max(
      1,
      Number.parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    );

    // Restrict results to the current user unless admin requests all.
    const filter =
      req.user.role === "admin" && req.query.all === "true"
        ? {}
        : { userId: String(req.user.userId) };

    // Fetch orders and total count concurrently.
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      Order.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (e) {
    next(e);
  }
}

// Retrieve a single order by ID.
export async function getOrder(req, res, next) {
  try {
    // Validate the supplied MongoDB ObjectId.
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    // Find the requested order.
    const order = await Order.findById(req.params.id).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    // Only the order owner or an admin can access it.
    if (
      String(order.userId) !== String(req.user.userId) &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "You cannot access this order.",
      });
    }

    return res.json({ success: true, order });
  } catch (e) {
    next(e);
  }
}

// Cancel an order and release its reserved inventory.
export async function cancelOrder(req, res, next) {
  try {
    // Validate the order ID.
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    // Atomically transition pending order to cancellation_pending.
    // This prevents multiple concurrent cancellation attempts.
    const order = await Order.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: String(req.user.userId),
        status: "pending",
      },
      {
        $set: {
          status: "cancellation_pending",
          cancellationReason:
            typeof req.body?.reason === "string"
              ? req.body.reason.trim().slice(0, 500)
              : undefined,
        },
      },
      { new: true, runValidators: true }
    );

    // If the atomic update failed, determine why.
    if (!order) {
      const current = await Order.findOne({
        _id: req.params.id,
        userId: String(req.user.userId),
      }).lean();

      if (!current) {
        return res.status(404).json({
          success: false,
          message: "Order not found.",
        });
      }

      return res.status(409).json({
        success: false,
        message: `Order cannot be cancelled from status '${current.status}'.`,
      });
    }

    try {
      // Release inventory reserved for the order.
      await releaseInventory(
        order.reservationId,
        reservationItemsFromOrder(order)
      );

      // Mark the order cancelled after inventory release succeeds.
      const cancelled = await Order.findOneAndUpdate(
        { _id: order._id, status: "cancellation_pending" },
        {
          $set: {
            status: "cancelled",
            stockReleasedAt: new Date(),
          },
        },
        { new: true }
      );

      return res.json({
        success: true,
        message: "Order cancelled and stock released.",
        order: cancelled,
      });
    } catch (error) {
      // Leave cancellation_pending for background recovery.
      console.error(
        "Cancellation queued for durable recovery",
        String(order._id),
        error.message
      );

      return res.status(202).json({
        success: true,
        message:
          "Cancellation accepted; inventory release is pending recovery.",
        order,
      });
    }
  } catch (e) {
    next(e);
  }
}
