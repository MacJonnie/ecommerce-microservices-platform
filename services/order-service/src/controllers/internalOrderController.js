    import mongoose from "mongoose";
import Order from "../model/Order.js";

/** Return an order to a trusted internal service (e.g. Payment Service). */
export async function getInternalOrder(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    const order = await Order.findById(req.params.id).lean();
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    return res.json({ success: true, order });
  } catch (error) {
    return next(error);
  }
}

/**
 * Apply a verified payment state to an order.
 * This endpoint is internal-only; clients cannot mark their own orders paid.
 */
export async function updateInternalPaymentStatus(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    const { status, paymentReference, providerTransactionId, paidAt } = req.body ?? {};
    if (!["pending", "paid", "payment_failed"].includes(status) || !paymentReference) {
      return res.status(400).json({
        success: false,
        message: "Valid status and paymentReference are required.",
      });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    // Payment cannot be applied to an order that has been cancelled
    // or moved into cancellation recovery.
    if (["cancelled", "cancellation_pending"].includes(order.status)) {
      return res.status(409).json({
        success: false,
        message: `Order is not payable in status '${order.status}'.`,
      });
    }

    // A paid order is immutable except for an exact idempotent replay.
    if (order.paymentStatus === "paid") {
      if (order.paymentReference === paymentReference) {
        return res.json({ success: true, duplicate: true, order });
      }
      return res.status(409).json({
        success: false,
        message: "Order has already been paid with another reference.",
      });
    }

    if (status === "paid") {
      order.paymentStatus = "paid";
      order.paymentReference = paymentReference;
      order.providerTransactionId = providerTransactionId || null;
      order.paidAt = paidAt ? new Date(paidAt) : new Date();
    } else if (status === "pending") {
      // A newly initialized payment attempt can replace a prior failed attempt.
      if (order.paymentStatus === "paid") {
        return res.status(409).json({
          success: false,
          message: "A paid order cannot start another payment attempt.",
        });
      }
      order.paymentStatus = "pending";
      order.paymentReference = paymentReference;
    } else {
      // A late failure event must not overwrite a newer payment attempt.
      if (
        order.paymentStatus !== "payment_failed" &&
        order.paymentReference &&
        order.paymentReference !== paymentReference
      ) {
        return res.status(409).json({
          success: false,
          message: "Payment reference does not match the order's current attempt.",
        });
      }
      order.paymentStatus = "payment_failed";
      order.paymentReference = paymentReference;
    }

    await order.save();
    return res.json({ success: true, order });
  } catch (error) {
    return next(error);
  }
}
