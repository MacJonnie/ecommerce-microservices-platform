
import { Router } from "express";

import authMiddleware from "../middleware/authMiddleware.js";

import {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart,
} from "../controllers/cartController.js";

const router = Router();

// Protect all cart routes with authentication.
router.use(authMiddleware);

// Retrieve the authenticated user's cart.
router.get("/", getCart);

// Add an item to the cart.
router.post("/items", addCartItem);

// Update an item's quantity.
router.patch("/items/:productId", updateCartItem);

// Remove an item from the cart.
router.delete("/items/:productId", removeCartItem);

// Remove all items from the cart.
router.delete("/", clearCart);

export default router;
