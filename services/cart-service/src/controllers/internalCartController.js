
import mongoose from "mongoose";
import Cart from "../models/Cart.js";

// Retrieve a user's cart for internal service communication.
export async function getUserCartInternal(req, res, next) {
  try {
    const { userId } = req.params;

    // Validate the userId parameter.
    if (!userId || userId.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId.",
      });
    }

    // Retrieve the cart without converting it into a Mongoose document.
    const cart = await Cart.findOne({ userId }).lean();

    // Return the cart with a normalized revision value.
    return res.json({
      success: true,
      cart: cart
        ? {
            ...cart,
            revision: Number.isInteger(cart.revision)
              ? cart.revision
              : 0,
          }
        : {
            userId,
            items: [],
            revision: 0,
          },
    });
  } catch (error) {
    // Forward errors to the centralized error handler.
    next(error);
  }
}

// Clear only the exact cart revision used to create the order.
// A changed cart is never wiped by an in-flight checkout.
export async function clearUserCartInternal(req, res, next) {
  try {
    const { userId } = req.params;
    const { expectedRevision } = req.body ?? {};

    // Validate the expected cart revision.
    if (
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "expectedRevision is required.",
      });
    }

    // Retrieve the current cart.
    const cart = await Cart.findOne({ userId });

    // Handle a cart that does not exist.
    if (!cart) {
      if (expectedRevision === 0) {
        return res.json({
          success: true,
          cleared: true,
          cart: {
            userId,
            items: [],
            revision: 0,
          },
        });
      }

      return res.status(409).json({
        success: false,
        cleared: false,
        message: "Cart revision changed.",
      });
    }

    // Reject the request if the cart revision has changed.
    if (
      (Number.isInteger(cart.revision) ? cart.revision : 0) !==
      expectedRevision
    ) {
      return res.status(409).json({
        success: false,
        cleared: false,
        message: "Cart changed during checkout.",
        currentRevision: cart.revision,
      });
    }

    // Build a revision filter that also supports legacy carts
    // without a stored revision field.
    const revisionFilter =
      expectedRevision === 0
        ? {
            $or: [
              { revision: 0 },
              { revision: { $exists: false } },
            ],
          }
        : {
            revision: expectedRevision,
          };

    // Atomically clear the cart only if its revision still matches.
    // Increment the revision to identify the updated cart state.
    const updated = await Cart.findOneAndUpdate(
      { userId, ...revisionFilter },
      {
        $set: { items: [] },
        $inc: { revision: 1 },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    // If the revision changed during the operation, reject the clear.
    if (!updated) {
      return res.status(409).json({
        success: false,
        cleared: false,
        message: "Cart changed during checkout.",
      });
    }

    // Return the updated cart.
    return res.json({
      success: true,
      cleared: true,
      cart: updated,
    });
  } catch (error) {
    // Forward errors to the centralized error handler.
    next(error);
  }
}
