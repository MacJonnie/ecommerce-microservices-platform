
import { Router } from "express";

import internalServiceMiddleware
  from "../middleware/internalServiceMiddleware.js";

import {
  getUserCartInternal,
  clearUserCartInternal,
} from "../controllers/internalCartController.js";

const router = Router();

router.use(internalServiceMiddleware);

router.get("/:userId", getUserCartInternal);
router.delete("/:userId", clearUserCartInternal);

export default router;
