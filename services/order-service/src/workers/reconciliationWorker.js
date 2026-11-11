
import CheckoutAttempt from "../model/CheckoutAttempt.js";
import Order from "../model/Order.js";
import { releaseInventory } from "../service/catalogClient.js";
import { clearCart } from "../service/cartClient.js";

// Convert order items into the format expected by the inventory service.
// Product IDs are converted to strings for consistent API communication.
const reservationItems = (order) =>
  order.items.map((item) => ({
    productId: String(item.productId),
    quantity: item.quantity,
  }));

// Process pending reconciliation and compensation tasks.
// This function is executed periodically by the background worker.
export async function runReconciliationBatch() {
  // ---------------------------------------------------------
  // 1. Recover stale checkout attempts in the "reserved" state
  // ---------------------------------------------------------
  // A checkout may crash after inventory reservation but before
  // the attempt record is updated. Find attempts older than 60s.
  const staleReserved = await CheckoutAttempt.find({
    state: "reserved",
    updatedAt: {
      $lt: new Date(Date.now() - 60000),
    },
  }).limit(50);

  for (const job of staleReserved) {
    // Check whether the order was successfully created before
    // the process crashed.
    const order = await Order.findOne({
      userId: job.userId,
      idempotencyKey: job.idempotencyKey,
    });

    if (order) {
      // Order exists: resume checkout reconciliation by moving
      // the attempt to "order_created" so cart clearing can retry.
      await CheckoutAttempt.updateOne(
        { _id: job._id, state: "reserved" },
        {
          $set: {
            orderId: order._id,
            state: "order_created",
            nextAttemptAt: new Date(),
            lastError: null,
          },
        }
      );
    } else {
      // No order exists: inventory was reserved but checkout
      // did not complete. Release the reservation as compensation.
      try {
        await releaseInventory(
          job.reservationId,
          job.reservationItems
        );

        // Compensation succeeded; mark the attempt as failed.
        await CheckoutAttempt.updateOne(
          { _id: job._id, state: "reserved" },
          {
            $set: {
              state: "failed",
              lastError:
                "Recovered stale checkout without an order; reservation released.",
            },
          }
        );
      } catch (e) {
        // Inventory release failed. Schedule compensation retry.
        await CheckoutAttempt.updateOne(
          { _id: job._id, state: "reserved" },
          {
            $set: {
              state: "compensation_pending",
              lastError: e.message,
              nextAttemptAt: new Date(Date.now() + 15000),
            },
          }
        );
      }
    }
  }

  // ---------------------------------------------------------
  // 2. Reconcile orders whose cart clearing is still pending
  // ---------------------------------------------------------
  // An order may already exist while cart clearing failed.
  // Only process attempts whose retry time has arrived.
  const cartJobs = await CheckoutAttempt.find({
    state: "order_created",
    nextAttemptAt: { $lte: new Date() },
  }).limit(50);

  for (const job of cartJobs) {
    try {
      // Clear only the cart revision used during checkout.
      // This prevents deleting items added to a newer cart.
      const result = await clearCart(
        job.userId,
        job.cartRevision
      );

      if (result.cleared) {
        // Cart cleared successfully; reconciliation is complete.
        await CheckoutAttempt.updateOne(
          { _id: job._id, state: "order_created" },
          {
            $set: {
              state: "completed",
              lastError: null,
            },
          }
        );
      } else {
        // The service responded but did not confirm clearing.
        // Keep the attempt pending and schedule another retry.
        await CheckoutAttempt.updateOne(
          { _id: job._id, state: "order_created" },
          {
            $set: {
              lastError:
                "Cart was not cleared; retry scheduled.",
              nextAttemptAt: new Date(Date.now() + 30000),
            },
          }
        );
      }
    } catch (e) {
      // A 409 revision conflict means the user has modified
      // the cart since checkout. Preserve the newer cart.
      if (e.statusCode === 409) {
        await CheckoutAttempt.updateOne(
          { _id: job._id, state: "order_created" },
          {
            $set: {
              state: "cart_changed",
              lastError:
                "Cart revision changed; newer cart preserved.",
            },
          }
        );
      } else {
        // Other errors are treated as transient failures.
        // Retry cart clearing after 30 seconds.
        await CheckoutAttempt.updateOne(
          { _id: job._id, state: "order_created" },
          {
            $set: {
              lastError: e.message,
              nextAttemptAt: new Date(Date.now() + 30000),
            },
          }
        );
      }
    }
  }

  // ---------------------------------------------------------
  // 3. Retry pending inventory compensation
  // ---------------------------------------------------------
  // These attempts represent inventory reservations that could
  // not be released during the original checkout failure.
  const compensationJobs = await CheckoutAttempt.find({
    state: "compensation_pending",
    nextAttemptAt: { $lte: new Date() },
  }).limit(50);

  for (const job of compensationJobs) {
    try {
      // Release the inventory reservation again.
      // releaseInventory must be idempotent for safe retries.
      await releaseInventory(
        job.reservationId,
        job.reservationItems
      );

      // Compensation succeeded; mark the checkout as failed.
      await CheckoutAttempt.updateOne(
        {
          _id: job._id,
          state: "compensation_pending",
        },
        {
          $set: {
            state: "failed",
            lastError: null,
          },
        }
      );
    } catch (e) {
      // Compensation failed again. Increase retry attempts
      // and apply exponential backoff, capped at 5 minutes.
      await CheckoutAttempt.updateOne(
        {
          _id: job._id,
          state: "compensation_pending",
        },
        {
          $set: {
            attempts: job.attempts + 1,
            lastError: e.message,
            nextAttemptAt: new Date(
              Date.now() +
                Math.min(
                  300000,
                  10000 * 2 ** Math.min(job.attempts, 5)
                )
            ),
          },
        }
      );
    }
  }

  // ---------------------------------------------------------
  // 4. Recover pending order cancellations
  // ---------------------------------------------------------
  // A cancellation may crash or fail after being claimed but
  // before inventory has been released.
  const cancelJobs = await Order.find({
    status: "cancellation_pending",
  }).limit(50);

  for (const order of cancelJobs) {
    try {
      // Release inventory reserved for the cancelled order.
      await releaseInventory(
        order.reservationId,
        reservationItems(order)
      );

      // Mark cancellation complete only after stock release.
      await Order.updateOne(
        {
          _id: order._id,
          status: "cancellation_pending",
        },
        {
          $set: {
            status: "cancelled",
            stockReleasedAt: new Date(),
          },
        }
      );
    } catch (e) {
      // Log the failure. The next worker batch will retry.
      console.error(
        "Cancellation recovery retry failed",
        String(order._id),
        e.message
      );
    }
  }
}

// Start the background reconciliation worker.
export function startReconciliationWorker() {
  // Prevent overlapping batches within this Node.js process.
  let running = false;

  const tick = async () => {
    // Skip this tick if the previous batch is still running.
    if (running) return;

    running = true;

    try {
      // Execute one reconciliation batch.
      await runReconciliationBatch();
    } catch (e) {
      // Prevent worker errors from terminating the process.
      console.error(
        "Reconciliation worker batch failed",
        e
      );
    } finally {
      // Allow the next scheduled batch to execute.
      running = false;
    }
  };

  // Run reconciliation every 15 seconds.
  const timer = setInterval(tick, 15000);

  // Allow Node.js to exit naturally if this timer is the
  // only remaining active handle.
  timer.unref();

  // Execute the first batch immediately instead of waiting
  // for the first 15-second interval.
  void tick();

  // Return a cleanup function for stopping the worker.
  return () => clearInterval(timer);
}
