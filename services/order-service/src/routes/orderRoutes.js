import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { createOrder, listOrders, getOrder, cancelOrder } from "../controllers/orderController.js";

const router = Router(); 
router.use(authMiddleware); 

router.post("/", createOrder);
router.get("/", listOrders);
router.get("/:id", getOrder);
router.post("/:id/cancel", cancelOrder);

export default router;
