
import crypto from "node:crypto";
import mongoose from "mongoose";
import Order from "../model/Order.js";
import {
  getProduct,
  reserveInventory,
  releaseInventory,
} from "../service/catalogClient.js";

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

// Validates that the address contains every required field
// and that each field is a non-empty string.
function validAddress(value) {
  return (
    value &&
    addressFields.every(
      (k) =>
        typeof value[k] === "string" &&
        value[k].trim().length > 0
    )
  );
}

// Creates a new order after validating the request,
// retrieving product details, and reserving inventory.
export async function createOrder(req, res, next) {
  // Generate a unique ID to track this inventory reservation across the Order Service and Catalog Service.
  const reservationId = crypto.randomUUID();
  let reserved = false;

  try {
    const { items, shippingAddress } = req.body ?? {};

    // Ensure the request contains between 1 and 50 order items.
    if (
      !Array.isArray(items) ||
      items.length < 1 ||
      items.length > 50
    ) {
      return res.status(400).json({
        success: false,
        message: "items must contain between 1 and 50 entries.",
      });
    }

    // Validate the shipping address before processing the order.
    if (!validAddress(shippingAddress)) {
      return res.status(400).json({
        success: false,
        message: "A complete shippingAddress is required.",
      });
    }

    // Use a Map to combine duplicate product IDs into one entry.
    // This prevents the same product from being processed multiple times.
    const normalized = new Map();

    for (const item of items) {
      // Validate the product ID and ensure the quantity is an integer between 1 and 100.
      if (
        !item ||
        !mongoose.isValidObjectId(item.productId) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 100
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Each item requires a valid productId and integer quantity between 1 and 100.",
        });
      }

      const id = String(item.productId);

      // Add the quantity to any existing quantity for this product.
      normalized.set(
        id,
        (normalized.get(id) || 0) + item.quantity
      );
    }

    // Validate the combined quantity after duplicate products
    // have been merged.
    if ([...normalized.values()].some((q) => q > 100)) {
      return res.status(400).json({
        success: false,
        message:
          "Combined quantity for a product cannot exceed 100.",
      });
    }

    // Retrieve product details from the Catalog Service.
    // Promise.all allows independent product requests to run concurrently.
    const productDocs = await Promise.all(
      [...normalized.keys()].map(async (productId) => {
        const product = await getProduct(productId);

        // Prevent ordering products that are inactive.
        if (!product.isActive) {
          const e = new Error(
            `Product ${productId} is unavailable.`
          );
          e.statusCode = 409;
          throw e;
        }

        return {
          product,
          quantity: normalized.get(productId),
        };
      })
    );

    // Create order-item snapshots using the current product details.
    // These values are stored with the order so its item details and
    // prices are preserved even if the product changes later.
    const orderItems = productDocs.map(
      ({ product, quantity }) => ({
        productId: product._id,
        name: product.name,
        sku: product.sku ?? null,
        unitPrice: Number(product.price),
        quantity,
        imageUrl: product.images?.[0]?.url ?? null,
      })
    );

    // Calculate the total cost of all items before any shipping fees
    // or other additional charges.
    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    );

    // Prepare the product IDs and quantities required by the
    // Catalog Service to reserve inventory.
    const reservationItems = orderItems.map((item) => ({
      productId: String(item.productId),
      quantity: item.quantity,
    }));

    // Request an inventory reservation before saving the order.
    // Set the flag only after the reservation request succeeds.
    await reserveInventory(reservationId, reservationItems);
    reserved = true;

    try {
      // Persist the order after inventory has been reserved.
      const order = await Order.create({
        userId: String(req.user.userId),
        items: orderItems,
        subtotal,
        shippingAddress,
        reservationId,
        status: "pending",
      });

      return res.status(201).json({
        success: true,
        message: "Order created. Payment has not been taken.",
        order,
      });
    } catch (persistError) {
      // If saving the order fails after inventory was reserved,
      // attempt to release the reserved stock as compensation.
      try {
        await releaseInventory(reservationId, reservationItems);
        reserved = false;
      } catch (releaseError) {
        // Log the failure because inventory may need manual
        // reconciliation if the compensation request fails.
        console.error(
          "CRITICAL: inventory compensation failed",
          {
            reservationId,
            error: releaseError.message,
          }
        );
      }

      throw persistError;
    }
  } catch (error) {
    // Return a 404 when the requested product cannot be found.
    if (error.statusCode === 404) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    // Return a 409 for conflicts such as unavailable products
    // or insufficient inventory.
    if (error.statusCode === 409) {
      return res.status(409).json({
        success: false,
        message: error.message,
      });
    }

    // Handle Mongoose schema validation errors as bad requests.
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Order validation failed.",
      });
    }

    // If inventory was reserved but the operation encountered
    // an unexpected failure, flag it for possible reconciliation.
    if (reserved) {
      console.error(
        "Inventory reservation may require reconciliation",
        { reservationId }
      );
    }

    // Pass unexpected errors to the application's error handler.
    return next(error);
  }
}

// Retrieves a paginated list of orders.
// Regular users see their own orders; admins can request all orders.
export async function listOrders(req, res, next) {
  try {
    // Parse the page number, defaulting to page 1.
    const page = Math.max(
      1,
      Number.parseInt(req.query.page, 10) || 1
    );

    // Limit each response to a maximum of 100 orders.
    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(req.query.limit, 10) || 10
      )
    );

    // Only admins requesting all=true can retrieve every user's orders.
    // Otherwise, restrict the query to the authenticated user.
    const filter =
      req.user.role === "admin" &&
      req.query.all === "true"
        ? {}
        : { userId: String(req.user.userId) };

    // Fetch the requested page and total matching order count concurrently.
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 }) // Show newest orders first.
        .skip((page - 1) * limit) // Skip orders from previous pages.
        .limit(limit) // Restrict the number of returned orders.
        .lean(), // Return plain JavaScript objects instead of Mongoose documents.

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
    // Forward unexpected errors to the central error handler.
    next(e);
  }
}

// Retrieves a single order by its MongoDB ID.
export async function getOrder(req, res, next) {
  try {
    // Reject malformed order IDs before querying MongoDB.
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    // Find the order and return it as a plain JavaScript object.
    const order = await Order.findById(req.params.id).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    // Allow access only to the order's owner or an administrator.
    if (
      String(order.userId) !== String(req.user.userId) &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "You cannot access this order.",
      });
    }

    return res.json({
      success: true,
      order,
    });
  } catch (e) {
    // Forward unexpected errors to the central error handler.
    next(e);
  }
}

// Cancels a pending order and requests the release of its inventory.
export async function cancelOrder(req, res, next) {
  try {
    // Validate the order ID before looking up the order.
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    // Find an order belonging to the authenticated user.
    const order = await Order.findOne({
      _id: req.params.id,
      userId: String(req.user.userId),
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    // Only pending orders can be cancelled.
    if (order.status !== "pending") {
      return res.status(409).json({
        success: false,
        message: "Only pending orders can be cancelled.",
      });
    }

    // A reservation ID is required to identify the inventory
    // that must be released in the Catalog Service.
    if (!order.reservationId) {
      return res.status(409).json({
        success: false,
        message:
          "Order has no inventory reservation record; manual reconciliation is required.",
      });
    }

    // Request the Catalog Service to release the reserved stock.
    await releaseInventory(
      order.reservationId,
      order.items.map((i) => ({
        productId: String(i.productId),
        quantity: i.quantity,
      }))
    );

    // Update the order only after the inventory release request succeeds.
    order.status = "cancelled";
    order.stockReleasedAt = new Date();

    // Save an optional cancellation reason, trimming whitespace
    // and limiting the stored value to 500 characters.
    order.cancellationReason =
      typeof req.body?.reason === "string"
        ? req.body.reason.trim().slice(0, 500)
        : undefined;

    await order.save();

    return res.json({
      success: true,
      message: "Order cancelled and stock released.",
      order,
    });
  } catch (e) {
    // Forward unexpected errors to the central error handler.
    next(e);
  }
}
