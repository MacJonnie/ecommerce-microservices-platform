
import { Router } from "express";
import mongoose from "mongoose";
import { timingSafeEqual } from "node:crypto";
import Product from "../models/Product.js";
import InventoryReservation from "../models/inventoryReservation.js";

const router = Router();

// Middleware to ensure that only services with the correct internal token
// can access the inventory reservation and release endpoints.
function internalOnly(req, res, next) {
  // Get the expected token from the Catalog Service environment.
  const expected = process.env.INTERNAL_SERVICE_TOKEN;

  // Get the token supplied by the requesting service.
  const supplied = req.get("x-internal-service-token");

  // Reject requests if either token is missing.
  if (!expected || !supplied) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized internal service request.",
    });
  }

  // Convert both tokens into buffers for a timing-safe comparison.
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);

  // Check their lengths before comparing them.
  // timingSafeEqual helps avoid timing-based information leaks.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized internal service request.",
    });
  }

  // Allow the request to continue if the tokens match.
  return next();
}

// Apply internal authentication to every route registered on this router.
router.use(internalOnly);

// Reserves stock for an order by reducing product inventory.
router.post("/reservations", async (req, res) => {
  // Extract the reservation ID and requested items from the request body.
  const { reservationId, items } = req.body ?? {};

  // Validate the reservation ID and ensure the request contains
  // between 1 and 50 items.
  if (
    typeof reservationId !== "string" ||
    !reservationId.trim() ||
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length > 50
  ) {
    return res.status(400).json({
      success: false,
      message: "reservationId and 1-50 items are required.",
    });
  }

  // Use a Map to combine duplicate product IDs into a single entry.
  const normalized = new Map();

  for (const item of items) {
    // Validate each product ID and ensure its quantity is an integer
    // between 1 and 100.
    if (
      !mongoose.isValidObjectId(item?.productId) ||
      !Number.isInteger(item?.quantity) ||
      item.quantity < 1 ||
      item.quantity > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid inventory item.",
      });
    }

    const id = String(item.productId);

    // Add the quantity to the existing quantity for this product,
    // or start at zero if this is the first occurrence.
    normalized.set(
      id,
      (normalized.get(id) || 0) + item.quantity
    );
  }

  // Convert the Map into an array of product ID and quantity objects.
  const normalizedItems = [...normalized].map(
    ([productId, quantity]) => ({
      productId,
      quantity,
    })
  );

  // Check whether this reservation ID has already been processed.
  const existing = await InventoryReservation.findOne({
    reservationId,
  }).lean();

  if (existing) {
    // If the reservation already succeeded, return the existing result
    // without deducting stock a second time.
    if (existing.status === "reserved") {
      return res.json({
        success: true,
        reservationId,
        status: existing.status,
        idempotentReplay: true,
      });
    }

    // Do not process a reservation ID that has already been released
    // or has failed.
    return res.status(409).json({
      success: false,
      message:
        "This reservation ID has already been released or failed.",
    });
  }

  // Track each successful stock deduction so it can be reversed
  // if a later deduction fails.
  const changed = [];

  try {
    // Create the reservation record before modifying product stock.
    // The unique reservationId index is intended to prevent duplicate IDs.
    await InventoryReservation.create({
      reservationId,
      items: normalizedItems,
      status: "reserving",
    });

    // Process each normalized product reservation.
    for (const item of normalizedItems) {
      // Atomically find an active product with enough stock
      // and deduct the requested quantity.
      const product = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          isActive: true,
          stock: { $gte: item.quantity },
        },
        {
          $inc: { stock: -item.quantity },
        },
        {
          new: true,
          runValidators: true,
        }
      ).select("_id stock");

      // If no product matches, it may be inactive, unavailable,
      // or have insufficient stock.
      if (!product) {
        const error = new Error(
          `Insufficient stock or unavailable product: ${item.productId}`
        );

        error.statusCode = 409;
        throw error;
      }

      // Record the successful deduction for possible compensation.
      changed.push(item);
    }

    // Mark the reservation as complete after all stock deductions succeed.
    await InventoryReservation.updateOne(
      { reservationId, status: "reserving" },
      {
        $set: {
          status: "reserved",
          items: normalizedItems,
        },
      }
    );

    return res.status(201).json({
      success: true,
      reservationId,
      status: "reserved",
      items: normalizedItems,
    });
  } catch (error) {
    // Attempt to reverse every successful stock deduction if reservation
    // processing fails. Promise.allSettled allows all reversals to be
    // attempted even if one of them fails.
    await Promise.allSettled(
      changed.map((item) =>
        Product.updateOne(
          { _id: item.productId },
          { $inc: { stock: item.quantity } }
        )
      )
    );

    // Record the failed reservation and the error for troubleshooting.
    await InventoryReservation.updateOne(
      { reservationId },
      {
        $set: {
          status: "failed",
          items: normalizedItems,
          lastError: error.message,
        },
      }
    );

    // Return the known status code when available; otherwise,
    // return a server error.
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.statusCode
          ? error.message
          : "Inventory reservation failed; compensation attempted.",
      });
  }
});

// Releases stock associated with a previously successful reservation.
router.post("/releases", async (req, res) => {
  // Extract the reservation ID from the request body.
  const { reservationId } = req.body ?? {};

  // Ensure a non-empty reservation ID was supplied.
  if (
    typeof reservationId !== "string" ||
    !reservationId.trim()
  ) {
    return res.status(400).json({
      success: false,
      message: "reservationId is required.",
    });
  }

  // Retrieve the reservation record from the database.
  const reservation = await InventoryReservation.findOne({
    reservationId,
  });

  // A reservation must exist before its stock can be released.
  if (!reservation) {
    return res.status(404).json({
      success: false,
      message: "Inventory reservation not found.",
    });
  }

  // If stock has already been released, return success without
  // increasing stock again.
  if (reservation.status === "released") {
    return res.json({
      success: true,
      reservationId,
      status: "released",
      idempotentReplay: true,
    });
  }

  // Only successfully reserved inventory can be released.
  if (reservation.status !== "reserved") {
    return res.status(409).json({
      success: false,
      message: `Reservation cannot be released from status ${reservation.status}.`,
    });
  }

  // Atomically claim the release by changing the status from
  // "reserved" to "releasing". This prevents concurrent requests
  // from both claiming the same reservation.
  // A reconciliation job is still needed if the process crashes
  // after this status change but before all stock is restored.
  const claimed = await InventoryReservation.findOneAndUpdate(
    { reservationId, status: "reserved" },
    { $set: { status: "releasing" } },
    { new: true }
  );

  // If another request already claimed the release, stop here.
  if (!claimed) {
    return res.status(409).json({
      success: false,
      message: "Reservation is already being released.",
    });
  }

  try {
    // Restore the quantity recorded in the reservation for each product.
    for (const item of claimed.items) {
      const result = await Product.updateOne(
        { _id: item.productId },
        { $inc: { stock: item.quantity } }
      );

      // Stop if the referenced product no longer exists.
      if (!result.matchedCount) {
        throw new Error(
          `Product missing while releasing reservation: ${item.productId}`
        );
      }
    }

    // Mark the reservation as released and record when the release completed.
    await InventoryReservation.updateOne(
      { reservationId, status: "releasing" },
      {
        $set: {
          status: "released",
          releasedAt: new Date(),
        },
      }
    );

    return res.json({
      success: true,
      reservationId,
      status: "released",
    });
  } catch (error) {
    // Log failures because some products may already have had their
    // stock restored. Reconciliation may be needed to resolve the state.
    console.error(
      "Inventory release requires reconciliation",
      {
        reservationId,
        error: error.message,
      }
    );

    return res.status(500).json({
      success: false,
      message: "Inventory release requires reconciliation.",
      reservationId,
    });
  }
});

// Export the router so the Catalog Service server can mount it.
export default router;
