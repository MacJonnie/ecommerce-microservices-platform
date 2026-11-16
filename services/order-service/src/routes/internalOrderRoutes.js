import { Router } from "express";
import internalAuth from "../middleware/internalAuth.js";
import {
  getInternalOrder,
  updateInternalPaymentStatus,
} from "../controllers/internalOrderController.js";

const router = Router();

// Protect all internal order operations with the shared service token.
router.use(internalAuth);
router.get("/:id", getInternalOrder);
router.post("/:id/payment-status", updateInternalPaymentStatus);

export default router;
