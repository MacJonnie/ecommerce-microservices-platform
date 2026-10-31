
import mongoose from "mongoose";
import Cart from "../models/Cart.js";

// Helper function to check whether an ID is a valid MongoDB ObjectId.
const invalidId = (id) => !mongoose.isValidObjectId(id);

// Retrieves the authenticated user's cart.
export async function getCart(req, res, next) {
  try {
    // Find the cart belonging to the logged-in user.
    // lean() returns a plain JavaScript object instead of a Mongoose document.
    const cart = await Cart.findOne({
      userId: req.user.userId,
    }).lean();

    // If the user has no cart yet, return an empty cart structure.
    return res.json({
      success: true,
      cart: cart ?? { items: [] },
    });
  } catch (error) {
    // Forward unexpected errors to the central error-handling middleware.
    next(error);
  }
}

// Adds a product to the authenticated user's cart.
export async function addCartItem(req, res, next) {
  try {
    // Extract the product ID and quantity from the request body.
    const { productId, quantity } = req.body ?? {};

    // Validate the supplied product ID before processing the request.
    if (invalidId(productId)) {
      return res.status(400).json({
        success: false,
        message: "A valid productId is required.",
      });
    }

    // Ensure quantity is an integer between 1 and 100.
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "quantity must be an integer between 1 and 100.",
      });
    }

    // Retrieve the user's existing cart from the database.
    let cart = await Cart.findOne({
      userId: req.user.userId,
    });

    // Create a new cart if the user does not have one yet.
    if (!cart) {
      cart = new Cart({
        userId: req.user.userId,
        items: [],
      });
    }

    // Check whether the product already exists in the cart.
    const item = cart.items.find(
      (entry) => entry.productId.toString() === productId
    );

    if (item) {
      // If the product already exists, ensure the combined quantity
      // does not exceed the maximum allowed quantity of 100.
      if (item.quantity + quantity > 100) {
        return res.status(400).json({
          success: false,
          message: "An item quantity cannot exceed 100.",
        });
      }

      // Increase the quantity of the existing cart item.
      item.quantity += quantity;
    } else {
      // Prevent the cart from containing more than 50 distinct items.
      if (cart.items.length >= 50) {
        return res.status(409).json({
          success: false,
          message: "Cart item limit reached.",
        });
      }

      // Add the product as a new item in the cart.
      cart.items.push({
        productId,
        quantity,
      });
    }

    // Save the updated cart to MongoDB.
    await cart.save();

    return res.status(200).json({
      success: true,
      message: "Cart updated.",
      cart,
    });
  } catch (error) {
    // Forward unexpected errors to the central error handler.
    next(error);
  }
}

// Updates the quantity of an existing product in the cart.
export async function updateCartItem(req, res, next) {
  try {
    // Get the product ID from the URL and the new quantity from the body.
    const { productId } = req.params;
    const { quantity } = req.body ?? {};

    // Validate the product ID.
    if (invalidId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productId.",
      });
    }

    // Ensure the new quantity is an integer between 1 and 100.
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "quantity must be an integer between 1 and 100.",
      });
    }

    // Find the authenticated user's cart.
    const cart = await Cart.findOne({
      userId: req.user.userId,
    });

    // Return an error if the user has no cart.
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found.",
      });
    }

    // Find the requested product within the cart.
    const item = cart.items.find(
      (entry) => entry.productId.toString() === productId
    );

    // Return an error if the product is not in the cart.
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart.",
      });
    }

    // Replace the current quantity with the requested quantity.
    item.quantity = quantity;

    // Persist the updated cart.
    await cart.save();

    return res.json({
      success: true,
      message: "Cart item updated.",
      cart,
    });
  } catch (error) {
    // Forward unexpected errors to the central error handler.
    next(error);
  }
}

// Removes a specific product from the authenticated user's cart.
export async function removeCartItem(req, res, next) {
  try {
    // Read the product ID from the URL parameters.
    const { productId } = req.params;

    // Validate the product ID before querying the cart.
    if (invalidId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productId.",
      });
    }

    // Find the cart belonging to the authenticated user.
    const cart = await Cart.findOne({
      userId: req.user.userId,
    });

    // Return an error if no cart exists.
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found.",
      });
    }

    // Store the original item count so we can determine whether
    // the requested product was actually present.
    const originalLength = cart.items.length;

    // Keep every cart item except the one matching the supplied product ID.
    cart.items = cart.items.filter(
      (entry) => entry.productId.toString() !== productId
    );

    // If the item count did not change, the product was not in the cart.
    if (cart.items.length === originalLength) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart.",
      });
    }

    // Save the cart after removing the product.
    await cart.save();

    return res.json({
      success: true,
      message: "Cart item removed.",
      cart,
    });
  } catch (error) {
    // Forward unexpected errors to the central error handler.
    next(error);
  }
}

// Removes all items from the authenticated user's cart.
export async function clearCart(req, res, next) {
  try {
    // Set the items array to empty.
    // upsert creates a cart if one does not already exist.
    // new: true returns the updated document.
    // setDefaultsOnInsert applies schema defaults when creating a cart.
    const cart = await Cart.findOneAndUpdate(
      { userId: req.user.userId },
      { $set: { items: [] } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.json({
      success: true,
      message: "Cart cleared.",
      cart,
    });
  } catch (error) {
    // Forward unexpected errors to the central error handler.
    next(error);
  }
}
