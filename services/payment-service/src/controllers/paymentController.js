import crypto from "node:crypto";
import mongoose from "mongoose";

import Payment from "../models/Payment.js";
import { initialize, verify } from "../services/provider.js";
import {
  getOrder,
  getUser,
  updateOrderPayment,
  notify,
} from "../services/internalClients.js";

// The User Service JWT contains userId; use that stable claim consistently.
const authenticatedUserId = (req) => String(req.user.userId);

// Paystack accepts amounts in Kobo (100 Kobo = ₦1).
const toKobo = (naira) => Math.round(Number(naira) * 100);

/**
 * Initialize a Paystack transaction for an unpaid order.
 * Idempotency is scoped to the authenticated customer.
 */
export async function initializePayment(req, res, next) {
  try {
    const { orderId } = req.body ?? {};
    const idempotencyKey = req.get("Idempotency-Key");

    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: "A valid orderId is required.",
      });
    }

    if (
      !idempotencyKey ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 128 ||
      !/^[\w.:=-]+$/.test(idempotencyKey)
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide an Idempotency-Key (8–128 safe characters).",
      });
    }

    const userId = authenticatedUserId(req);

    // Reuse the original payment when this request is replayed.
    const existing = await Payment.findOne({ userId, idempotencyKey });
    if (existing) {
      if (String(existing.orderId) !== String(orderId)) {
        return res.status(409).json({
          success: false,
          message: "This Idempotency-Key was already used for another order.",
        });
      }
      if (existing.status === "pending") {
        await updateOrderPayment(existing.orderId, {
          status: "pending",
          paymentReference: existing.reference,
        });
      }
      return res.status(200).json({
        success: true,
        replayed: true,
        payment: {
          reference: existing.reference,
          amount: existing.amount,
          currency: existing.currency,
          status: existing.status,
          authorizationUrl: existing.authorizationUrl,
        },
      });
    }

    // Confirm ownership and payable state using Order Service data.
    const order = await getOrder(orderId);
    if (!order || String(order.userId) !== userId) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    if (order.status !== "pending" || order.paymentStatus === "paid") {
      return res.status(409).json({
        success: false,
        message: "Order is not payable.",
      });
    }

    if (!Number.isSafeInteger(Number(order.subtotal)) || Number(order.subtotal) < 1) {
      return res.status(400).json({
        success: false,
        message: "Order amount is invalid for payment.",
      });
    }

    // Obtain the email from the trusted User Service, not from JWT claims.
    const user = await getUser(userId);
    if (!user?.email) {
      return res.status(400).json({
        success: false,
        message: "A verified customer email is required for payment.",
      });
    }

    const reference = `pay_${crypto.randomUUID().replaceAll("-", "")}`;
    const amount = toKobo(order.subtotal);

    // The unique database index handles concurrent requests using the same key.
    let payment;
    try {
      payment = await Payment.create({
        orderId,
        userId,
        reference,
        idempotencyKey,
        amount,
        currency: "NGN",
        status: "initialized",
      });
    } catch (error) {
      if (error.code === 11000) {
        const duplicate = await Payment.findOne({ userId, idempotencyKey });
        if (duplicate) {
          if (String(duplicate.orderId) !== String(orderId)) {
            return res.status(409).json({
              success: false,
              message: "This Idempotency-Key was already used for another order.",
            });
          }
          return res.status(200).json({
            success: true,
            replayed: true,
            payment: {
              reference: duplicate.reference,
              amount: duplicate.amount,
              currency: duplicate.currency,
              status: duplicate.status,
              authorizationUrl: duplicate.authorizationUrl,
            },
          });
        }
      }
      throw error;
    }

    let providerData;
    try {
      providerData = await initialize({
        email: user.email,
        amount,
        reference,
        callbackUrl: process.env.PAYMENT_CALLBACK_URL,
        metadata: { orderId: String(orderId), userId },
      });
    } catch (error) {
      // Paystack did not initialize the transaction; this payment can be retried.
      payment.status = "failed";
      payment.lastError = error.message?.slice(0, 500);
      await payment.save();
      throw error;
    }

    // Persist the provider transaction before synchronizing Order Service.
    payment.authorizationUrl = providerData.authorization_url;
    payment.accessCode = providerData.access_code;
    payment.status = "pending";
    await payment.save();

    // Reflect the active transaction on the order record.
    // If this request fails, an idempotent replay synchronizes it again.
    await updateOrderPayment(orderId, {
      status: "pending",
      paymentReference: reference,
    });

    return res.status(201).json({
      success: true,
      payment: {
        reference,
        amount,
        currency: payment.currency,
        status: payment.status,
        authorizationUrl: payment.authorizationUrl,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Apply a provider result only after amount/currency/reference validation.
 * Updating the Order first means a failed Order update leaves the Payment
 * retryable rather than recording a locally completed payment prematurely.
 */
async function applyProviderResult(payment, data) {
  if (String(data.reference) !== payment.reference) {
    throw new Error("Paystack reference mismatch.");
  }

  if (data.status === "success") {
    if (Number(data.amount) !== payment.amount || data.currency !== payment.currency) {
      throw new Error("Payment amount/currency mismatch.");
    }

    // The Order Service makes an exact-reference paid update idempotent.
    // Replaying this block also retries notification enqueue if it previously
    // failed before reaching the Notification Service.
    await updateOrderPayment(payment.orderId, {
      status: "paid",
      paymentReference: payment.reference,
      providerTransactionId: String(data.id),
      paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
    });

    if (payment.status !== "success") {
      payment.status = "success";
      payment.providerTransactionId = String(data.id);
      payment.paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
      payment.lastError = null;
      await payment.save();
    }

    // Notification is best-effort here; payment confirmation must remain valid.
    // Its stable idempotency key prevents duplicate emails on webhook replay.
    try {
      await notify({
        event: "payment.success",
        userId: String(payment.userId),
        orderId: String(payment.orderId),
        paymentReference: payment.reference,
        amount: payment.amount,
        currency: payment.currency,
        idempotencyKey: `payment.success:${payment.reference}`,
      });
    } catch (error) {
      console.error("Payment notification enqueue failed:", error.message);
    }
    return;
  }

  if (["failed", "abandoned"].includes(data.status) && payment.status !== "success") {
    payment.status = data.status;
    payment.lastError = `Paystack transaction ${data.status}`;
    await payment.save();

    await updateOrderPayment(payment.orderId, {
      status: "payment_failed",
      paymentReference: payment.reference,
    });

    try {
      await notify({
        event: "payment.failed",
        userId: String(payment.userId),
        orderId: String(payment.orderId),
        paymentReference: payment.reference,
        amount: payment.amount,
        currency: payment.currency,
        idempotencyKey: `payment.failed:${payment.reference}`,
      });
    } catch (error) {
      console.error("Payment failure notification enqueue failed:", error.message);
    }
  }
}

/** Verify a transaction against Paystack, scoped to the current user. */
export async function verifyPayment(req, res, next) {
  try {
    const payment = await Payment.findOne({
      reference: req.params.reference,
      userId: authenticatedUserId(req),
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found.",
      });
    }

    const providerData = await verify(payment.reference);
    await applyProviderResult(payment, providerData);

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

/** Paystack webhook endpoint. The server must pass the untouched raw body. */
export async function webhook(req, res) {
  const signature = req.get("x-paystack-signature");
  const secret = process.env.PAYSTACK_SECRET_KEY;

  if (!secret || !Buffer.isBuffer(req.body)) {
    return res.status(500).send("Webhook is not configured correctly.");
  }

  const expected = crypto
    .createHmac("sha512", secret)
    .update(req.body)
    .digest("hex");

  if (
    !signature ||
    signature.length !== expected.length ||
    !/^[a-fA-F0-9]{128}$/.test(signature) ||
    !crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))
  ) {
    return res.status(401).send("Invalid signature.");
  }

  try {
    const event = JSON.parse(req.body.toString("utf8"));
    const reference = event.data?.reference;

    if (reference && ["charge.success", "charge.failed"].includes(event.event)) {
      const payment = await Payment.findOne({ reference });
      if (payment) await applyProviderResult(payment, event.data);
    }

    // Unknown events are acknowledged so Paystack does not retry indefinitely.
    return res.sendStatus(200);
  } catch (error) {
    console.error("Paystack webhook processing failed:", error.message);
    return res.sendStatus(500);
  }
}
