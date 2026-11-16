import { Router } from "express";
import internalAuth from "../middleware/internalAuth.js";
import { getInternalUser } from "../controllers/internalUserController.js";

const router = Router();

// Every route in this router requires internal service authentication.
router.use(internalAuth);
router.get("/:id", getInternalUser);

export default router;
