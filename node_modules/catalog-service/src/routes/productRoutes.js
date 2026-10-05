import express from "express";

import {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} from "../controllers/productController.js";

import authMiddleware from "../middleware/authMiddleware.js";
import authorizeRoles from "../middleware/roleMiddleware.js";
import uploadProductImages from "../middleware/uploadMiddleware.js";

const router = express.Router();

// PUBLIC ROUTES

router.get("/", getAllProducts);

router.get("/:id", getProductById);

// ADMIN ROUTES

router.post("/", authMiddleware, authorizeRoles("admin"), uploadProductImages.array("images", 6),
 createProduct);

router.patch("/:id", authMiddleware, authorizeRoles("admin"), updateProduct);

router.delete("/:id", authMiddleware, authorizeRoles("admin"), deleteProduct);

export default router;