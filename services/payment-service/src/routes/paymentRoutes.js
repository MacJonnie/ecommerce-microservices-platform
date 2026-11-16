
import { Router } from "express";

import auth from "../middleware/authMiddleware.js";

import {
  initializePayment,
  verifyPayment,
} from "../controllers/paymentController.js";

// Create the Payment Service router.
const router = Router();

// Require authentication for all payment routes.
router.use(auth);

// Initialize a payment for an existing order.
router.post("/initialize", initializePayment);

// Verify a payment using its Paystack transaction reference.
router.get("/verify/:reference", verifyPayment);

// Export the router for mounting in server.js.
export default router;
