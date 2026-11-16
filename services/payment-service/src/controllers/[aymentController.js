
import crypto from "node:crypto";

import Payment from "../models/Payment.js";

import { initialize, verify } from "../services/provider.js";

import {
  getOrder,
  updateOrderPayment,
  notify,
} from "../services/internalClients.js";

// Extract the authenticated user's ID from the JWT payload.
const userId = (req) => String(req.user.id || req.user._id);

// Convert Nigerian Naira to Kobo.
// Paystack expects transaction amounts in the smallest currency unit.
const kobo = (naira) => Math.round(Number(naira) * 100);

/**
 * Initialize a payment for an existing order.
 */
export async function initializePayment(req, res, next) {
  try {
    // Extract order ID and idempotency key from the request.
    const { orderId } = req.body;
    const key = req.get("Idempotency-Key");

    // Both values are required to initialize a payment.
    if (!orderId || !key) {
      return res.status(400).json({
        success: false,
        message: "orderId and Idempotency-Key required",
      });
    }

    // Check whether this request has already initialized a payment.
    const prior = await Payment.findOne({
      userId: userId(req),
      idempotencyKey: key,
    });

    // Return the existing payment instead of creating a duplicate.
    if (prior) {
      return res.json({
        success: true,
        payment: prior,
      });
    }

    // Retrieve the order from the Order Service.
    const order = await getOrder(orderId);

    // Ensure the order belongs to the authenticated user.
    if (!order || String(order.userId) !== userId(req)) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Only pending and unpaid orders can be paid for.
    if (order.status !== "pending" || order.paymentStatus === "paid") {
      return res.status(409).json({
        success: false,
        message: "Order is not payable",
      });
    }

    // Ensure the authenticated user's email is available.
    if (!req.user.email) {
      return res.status(400).json({
        success: false,
        message: "User email claim missing; add trusted user lookup",
      });
    }

    // Generate a unique reference for the Paystack transaction.
    const reference = `pay_${crypto.randomUUID().replaceAll("-", "")}`;

    // Convert the order subtotal from Naira to Kobo.
    const amount = kobo(order.subtotal);

    // Create a local payment record before contacting Paystack.
    const payment = await Payment.create({
      orderId,
      userId: userId(req),
      reference,
      idempotencyKey: key,
      amount,
      status: "initialized",
    });

    // Initialize the transaction with Paystack.
    const data = await initialize({
      email: req.user.email,
      amount,
      reference,
      callbackUrl: process.env.PAYMENT_CALLBACK_URL,
      metadata: {
        orderId: String(orderId),
        userId: userId(req),
      },
    });

    // Store the Paystack authorization details.
    payment.authorizationUrl = data.authorization_url;
    payment.accessCode = data.access_code;
    payment.status = "pending";

    await payment.save();

    // Return the payment details to the client.
    return res.status(201).json({
      success: true,
      payment: {
        id: payment._id,
        reference,
        amount,
        currency: "NGN",
        status: payment.status,
        authorizationUrl: payment.authorizationUrl,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Apply a verified Paystack transaction result.
 *
 * This function updates the local Payment record, Order Service,
 * and Notification Service where appropriate.
 */
async function applyResult(payment, data) {
  // Process successful transactions only once.
  if (data.status === "success" && payment.status !== "success") {
    // Validate the amount and currency before accepting payment.
    if (
      Number(data.amount) !== payment.amount ||
      data.currency !== "NGN"
    ) {
      throw new Error("Payment amount/currency mismatch");
    }

    // Mark the local payment as successful.
    payment.status = "success";
    payment.providerTransactionId = String(data.id);
    payment.paidAt = data.paid_at
      ? new Date(data.paid_at)
      : new Date();

    await payment.save();

    // Update the corresponding order's payment status.
    await updateOrderPayment(payment.orderId, {
      status: "paid",
      paymentReference: payment.reference,
      providerTransactionId: payment.providerTransactionId,
    });

    // Notification failures must not reverse a confirmed payment.
    try {
      await notify({
        event: "payment.success",
        userId: String(payment.userId),
        orderId: String(payment.orderId),
        paymentReference: payment.reference,
        amount: payment.amount,
        currency: "NGN",
      });
    } catch (error) {
      console.error(
        "Payment notification enqueue failed:",
        error.message
      );
    }
  } else if (
    ["failed", "abandoned"].includes(data.status) &&
    payment.status !== "success"
  ) {
    // Record failed or abandoned transactions.
    payment.status = data.status;

    await payment.save();

    // Inform the Order Service about the failed payment.
    await updateOrderPayment(payment.orderId, {
      status: "payment_failed",
      paymentReference: payment.reference,
    });
  }
}

/**
 * Verify a payment using its Paystack transaction reference.
 */
export async function verifyPayment(req, res, next) {
  try {
    // Find the payment belonging to the authenticated user.
    const payment = await Payment.findOne({
      reference: req.params.reference,
      userId: userId(req),
    });

    // Prevent users from verifying payments belonging to others.
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // Verify the transaction directly with Paystack.
    const data = await verify(payment.reference);

    // Apply the verified transaction result.
    await applyResult(payment, data);

    // Return the updated payment status.
    return res.json({
      success: true,
      payment: {
        reference: payment.reference,
        status: payment.status,
        paidAt: payment.paidAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handle Paystack webhook events.
 *
 * Paystack signs webhook requests using HMAC SHA-512.
 * The raw request body is required for signature verification.
 */
export async function webhook(req, res) {
  // Retrieve the signature and secret key.
  const signature = req.get("x-paystack-signature");
  const secret = process.env.PAYSTACK_SECRET_KEY;

  // Calculate the expected signature from the raw request body.
  const expected = crypto
    .createHmac("sha512", secret)
    .update(req.body)
    .digest("hex");

  // Reject requests with invalid signatures.
  if (
    !signature ||
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )
  ) {
    return res.status(401).send("Invalid signature");
  }

  try {
    // Parse the webhook payload after signature verification.
    const event = JSON.parse(req.body.toString());

    // Process successful transaction events.
    if (
      event.event === "charge.success" &&
      event.data?.reference
    ) {
      // Find the corresponding local payment record.
      const payment = await Payment.findOne({
        reference: event.data.reference,
      });

      // Apply the transaction result if the payment exists.
      if (payment) {
        await applyResult(payment, event.data);
      }
    }

    // Acknowledge successful webhook processing.
    return res.sendStatus(200);
  } catch (error) {
    // Log failures so Paystack can retry the webhook.
    console.error("Webhook processing failed:", error.message);

    return res.sendStatus(500);
  }
}
