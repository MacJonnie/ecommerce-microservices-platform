import mongoose from "mongoose";

import Notification from "../models/Notification.js";
import { sendEmail } from "../services/mailer.js";
import { getUser } from "../services/userClient.js";

const MAX_ATTEMPTS = 8;

/** Build simple text email templates for supported platform events. */
function buildTemplate(payload) {
  const amount = payload.amount != null
    ? `Amount: ${(Number(payload.amount) / 100).toLocaleString("en-NG", {
        style: "currency",
        currency: payload.currency || "NGN",
      })}`
    : "";

  const templates = {
    "order.created": {
      subject: `Order ${payload.orderId} received`,
      text: `Thank you for your order.\nOrder ID: ${payload.orderId}\n${amount}\nYour order is awaiting payment.`,
    },
    "order.cancelled": {
      subject: `Order ${payload.orderId} cancelled`,
      text: `Your order ${payload.orderId} has been cancelled.`,
    },
    "payment.success": {
      subject: "Payment successful",
      text: `Your payment was successful.\nOrder ID: ${payload.orderId}\nReference: ${payload.paymentReference}\n${amount}`,
    },
    "payment.failed": {
      subject: "Payment was not completed",
      text: `We could not confirm your payment.\nOrder ID: ${payload.orderId}\nReference: ${payload.paymentReference}\n${amount}\nYou may try payment again.`,
    },
  };

  return templates[payload.event] || {
    subject: "E-commerce account notification",
    text: `Notification event: ${payload.event}\nOrder ID: ${payload.orderId || "-"}`,
  };
}

/**
 * Claim and send a notification once.
 * Atomic claim prevents two worker loops from sending the same record together.
 */
export async function processNotification(notificationId) {
  const notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      status: { $in: ["queued", "failed"] },
      attempts: { $lt: MAX_ATTEMPTS },
      nextAttemptAt: { $lte: new Date() },
    },
    {
      $set: { status: "sending" },
      $inc: { attempts: 1 },
    },
    { new: true }
  );

  if (!notification) return null;

  try {
    await sendEmail({
      to: notification.recipient,
      subject: notification.subject,
      text: notification.message,
    });

    notification.status = "sent";
    notification.sentAt = new Date();
    notification.lastError = null;
    await notification.save();

    return notification;
  } catch (error) {
    const exhausted = notification.attempts >= MAX_ATTEMPTS;
    const delayMs = Math.min(30 * 60 * 1000, 15000 * 2 ** Math.min(notification.attempts - 1, 7));

    notification.status = "failed";
    notification.lastError = error.message?.slice(0, 1000) || "Email delivery failed";
    notification.nextAttemptAt = new Date(Date.now() + delayMs);
    await notification.save();

    console.error(
      `Notification ${notification._id} delivery failed (attempt ${notification.attempts}/${MAX_ATTEMPTS})`,
      notification.lastError
    );

    if (exhausted) {
      console.error(`Notification ${notification._id} exhausted retries.`);
    }
    return notification;
  }
}

/** Internal endpoint: persist an event and enqueue email delivery. */
export async function enqueue(req, res, next) {
  try {
    const payload = req.body ?? {};
    const { event, userId, orderId, paymentReference, amount, currency } = payload;

    if (!event || !mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "event and valid userId are required.",
      });
    }

    // Resolve email from the User Service; ignore caller-supplied recipient.
    const user = await getUser(String(userId));
    if (!user?.email) {
      return res.status(404).json({
        success: false,
        message: "Customer email could not be resolved.",
      });
    }

    const idempotencyKey = payload.idempotencyKey ||
      `${event}:${orderId || "-"}:${paymentReference || "-"}`;
    const template = buildTemplate({ event, orderId, paymentReference, amount, currency });

    let notification;
    try {
      notification = await Notification.create({
        event,
        userId,
        orderId: orderId || null,
        paymentReference: paymentReference || null,
        recipient: user.email,
        subject: template.subject,
        message: template.text,
        idempotencyKey,
        status: "queued",
      });
    } catch (error) {
      if (error.code !== 11000) throw error;

      notification = await Notification.findOne({ idempotencyKey });
      if (notification?.status === "sent") {
        return res.status(200).json({
          success: true,
          duplicate: true,
          notificationId: notification._id,
          status: notification.status,
        });
      }
    }

    // Attempt immediate delivery; durable record remains for retries.
    const processed = await processNotification(notification._id);

    return res.status(202).json({
      success: true,
      notificationId: notification._id,
      status: processed?.status || notification.status,
    });
  } catch (error) {
    return next(error);
  }
}

/** Retry queued/failed jobs and recover stale 'sending' records after a crash. */
export async function retryFailed() {
  const staleSendingBefore = new Date(Date.now() - 5 * 60 * 1000);

  // A process crash while sending must not strand a notification permanently.
  await Notification.updateMany(
    { status: "sending", updatedAt: { $lt: staleSendingBefore } },
    { $set: { status: "failed", nextAttemptAt: new Date() } }
  );

  const jobs = await Notification.find({
    status: { $in: ["queued", "failed"] },
    attempts: { $lt: MAX_ATTEMPTS },
    nextAttemptAt: { $lte: new Date() },
  })
    .sort({ nextAttemptAt: 1, createdAt: 1 })
    .limit(25)
    .select("_id");

  for (const job of jobs) {
    await processNotification(job._id);
  }
}
