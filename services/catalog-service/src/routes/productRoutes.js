import express from "express";

import {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  addProductImages,
  deleteProductImage,
} from "../controllers/productController.js";

import authMiddleware from "../middleware/authMiddleware.js";
import authorizeRoles from "../middleware/roleMiddleware.js";
import uploadProductImages from "../middleware/uploadMiddleware.js";

const router = express.Router();

// PUBLIC ROUTES
router.get("/", getAllProducts); // Get all products

router.get("/:id", getProductById); // Get product by ID


// ADMIN ROUTES
router.post("/", authMiddleware, authorizeRoles("admin"), uploadProductImages.array("images", 6),
 createProduct); // Create a new product

router.patch("/:id", authMiddleware, authorizeRoles("admin"), updateProduct); // Update a product

router.delete("/:id", authMiddleware, authorizeRoles("admin"), deleteProduct); // Delete a product

router.post("/:id/images", authMiddleware, authorizeRoles("admin"), uploadProductImages.array("images", 6), addProductImages); // Add images to a product

router.delete("/:id/images/:imageId", authMiddleware, authorizeRoles("admin"), deleteProductImage); // Delete an image from a product


export default router;