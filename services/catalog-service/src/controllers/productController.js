import Product from "../models/Product.js";
import mongoose from "mongoose";
import { uploadImage, deleteImage } from "../utils/cloudinary.js";


const MAX_PRODUCT_IMAGES = 6;

// Create product
export const createProduct = async (req, res) => {
  const uploadedImages = [];

  try {
    const {
      name,
      description,
      price,
      category,
      sku,
      stock,
    } = req.body;

    // ==========================================
    // REQUIRED FIELDS
    // ==========================================

    if (
      name === undefined ||
      description === undefined ||
      price === undefined ||
      category === undefined ||
      sku === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Name, description, price, category, and SKU are required.",
      });
    }

    // ==========================================
    // STRING VALIDATION
    // ==========================================

    if (
      typeof name !== "string" ||
      typeof description !== "string" ||
      typeof category !== "string" ||
      typeof sku !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Name, description, category, and SKU must be strings.",
      });
    }

    const cleanedName = name.trim();
    const cleanedDescription = description.trim();
    const cleanedCategory = category.trim();
    const normalizedSku = sku.trim().toUpperCase();

    if (
      !cleanedName ||
      !cleanedDescription ||
      !cleanedCategory ||
      !normalizedSku
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Name, description, category, and SKU cannot be empty.",
      });
    }

    // ==========================================
    // PRICE VALIDATION
    // ==========================================

    const numericPrice = Number(price);

    if (
      !Number.isFinite(numericPrice) ||
      numericPrice < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Price must be a valid non-negative number.",
      });
    }

    // ==========================================
    // STOCK VALIDATION
    // ==========================================

    const numericStock =
      stock === undefined ? 0 : Number(stock);

    if (
      !Number.isInteger(numericStock) ||
      numericStock < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Stock must be a non-negative whole number.",
      });
    }

    // ==========================================
    // IMAGE VALIDATION
    // ==========================================

    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one product image is required.",
      });
    }

    // ==========================================
    // DUPLICATE SKU CHECK
    // ==========================================

    const existingProduct = await Product.findOne({
      sku: normalizedSku,
    });

    if (existingProduct) {
      return res.status(409).json({
        success: false,
        message: "A product with this SKU already exists.",
      });
    }

    // ==========================================
    // UPLOAD IMAGES
    // ==========================================

    for (const file of files) {
      const result = await uploadImage(file.buffer, {
        folder: "ecommerce-platform/products",
      });

      uploadedImages.push({
        url: result.secure_url,
        publicId: result.public_id,
      });
    }

    // ==========================================
    // CREATE PRODUCT
    // ==========================================

    const product = await Product.create({
      name: cleanedName,
      description: cleanedDescription,
      price: numericPrice,
      category: cleanedCategory,
      images: uploadedImages,
      sku: normalizedSku,
      stock: numericStock,
      createdBy: req.user.userId,
    });

    return res.status(201).json({
      success: true,
      message: "Product created successfully.",
      product,
    });
  } catch (error) {
    console.error("Create product error:", error);

    // ==========================================
    // CLEANUP CLOUDINARY UPLOADS
    // ==========================================

    if (uploadedImages.length > 0) {
      await Promise.allSettled(
        uploadedImages.map((image) =>
          deleteImage(image.publicId)
        )
      );
    }

    // ==========================================
    // DUPLICATE SKU
    // ==========================================

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A product with this SKU already exists.",
      });
    }

    // ==========================================
    // MONGOOSE VALIDATION
    // ==========================================

    if (error.name === "ValidationError") {
      const validationErrors = Object.values(
        error.errors
      ).map((err) => err.message);

      return res.status(400).json({
        success: false,
        message: "Product validation failed.",
        errors: validationErrors,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// Get all products
export const getAllProducts = async (req, res) => {
  try {
    // ==========================================
    // PAGINATION
    // ==========================================

    const page = Math.max(
      parseInt(req.query.page, 10) || 1,
      1
    );

    const limit = Math.min(
      Math.max(
        parseInt(req.query.limit, 10) || 10,
        1
      ),
      100
    );

    const skip = (page - 1) * limit;

    // ==========================================
    // FILTERS
    // ==========================================

    const filter = {
      isActive: true,
    };

    // Category filter
    if (req.query.category) {
      filter.category = req.query.category.trim();
    }

    // Price filter
    if (
      req.query.minPrice !== undefined ||
      req.query.maxPrice !== undefined
    ) {
      filter.price = {};

      if (req.query.minPrice !== undefined) {
        const minPrice = Number(req.query.minPrice);

        if (Number.isNaN(minPrice) || minPrice < 0) {
          return res.status(400).json({
            success: false,
            message: "minPrice must be a valid non-negative number.",
          });
        }

        filter.price.$gte = minPrice;
      }

      if (req.query.maxPrice !== undefined) {
        const maxPrice = Number(req.query.maxPrice);

        if (Number.isNaN(maxPrice) || maxPrice < 0) {
          return res.status(400).json({
            success: false,
            message: "maxPrice must be a valid non-negative number.",
          });
        }

        filter.price.$lte = maxPrice;
      }
    }

    // ==========================================
    // SEARCH
    // ==========================================

    if (req.query.search) {
      const search = req.query.search.trim();

      if (search) {
        filter.$or = [
          {
            name: {
              $regex: search,
              $options: "i",
            },
          },
          {
            description: {
              $regex: search,
              $options: "i",
            },
          },
          {
            category: {
              $regex: search,
              $options: "i",
            },
          },
        ];
      }
    }

    // ==========================================
    // SORTING
    // ==========================================

    let sort = {
      createdAt: -1,
    };

    switch (req.query.sort) {
      case "price_asc":
        sort = { price: 1 };
        break;

      case "price_desc":
        sort = { price: -1 };
        break;

      case "name_asc":
        sort = { name: 1 };
        break;

      case "name_desc":
        sort = { name: -1 };
        break;

      case "newest":
        sort = { createdAt: -1 };
        break;

      case "oldest":
        sort = { createdAt: 1 };
        break;
    }

    // ==========================================
    // DATABASE QUERIES
    // ==========================================

    const [products, totalProducts] = await Promise.all([
      Product.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit),

      Product.countDocuments(filter),
    ]);

    // ==========================================
    // PAGINATION METADATA
    // ==========================================

    const totalPages = Math.ceil(totalProducts / limit);

    return res.status(200).json({
      success: true,

      products,

      pagination: {
        currentPage: page,
        limit,
        totalProducts,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get products error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// Get single product
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id);

    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    return res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    console.error("Get product error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// Update product
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    const allowedFields = [
      "name",
      "description",
      "price",
      "category",
      "images",
      "sku",
      "stock",
      "isActive",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        product[field] = req.body[field];
      }
    });

    await product.save();

    return res.status(200).json({
      success: true,
      message: "Product updated successfully.",
      product,
    });
  } catch (error) {
    console.error("Update product error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// Delete product
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID.",
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    /*
     * Delete the MongoDB product first.
     *
     * MongoDB is the source of truth for whether the product
     * exists in our catalog.
     */
    await Product.deleteOne({
      _id: id,
    });

    /*
     * Clean up all associated Cloudinary images.
     *
     * We use allSettled so one failed Cloudinary deletion does
     * not prevent the remaining assets from being cleaned up.
     */
    const cleanupResults = await Promise.allSettled(
      product.images.map((image) =>
        deleteImage(image.publicId)
      )
    );

    const failedCleanups = cleanupResults.filter(
      (result) => result.status === "rejected"
    );

    if (failedCleanups.length > 0) {
      console.error(
        "Some Cloudinary assets could not be deleted:",
        {
          productId: id,
          failedCount: failedCleanups.length,
        }
      );

      return res.status(200).json({
        success: true,
        message:
          "Product deleted successfully, but some Cloudinary images require cleanup.",
        cleanupWarning: true,
        deletedProductId: id,
        failedImageCleanupCount: failedCleanups.length,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product deleted successfully.",
      deletedProductId: id,
    });
  } catch (error) {
    console.error("Delete product error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


export const addProductImages = async (req, res) => {
  const uploadedImages = [];

  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID.",
      });
    }

    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one image is required.",
      });
    }

    if (files.length > MAX_PRODUCT_IMAGES) {
      return res.status(400).json({
        success: false,
        message: `You can upload a maximum of ${MAX_PRODUCT_IMAGES} images at a time.`,
      });
    }

    /*
     * Upload the files to Cloudinary first.
     *
     * We do this before changing MongoDB because we need the
     * Cloudinary URLs and public IDs before storing the images.
     */
    for (const file of files) {
      const result = await uploadImage(file.buffer);

      uploadedImages.push({
        _id: new mongoose.Types.ObjectId(),
        url: result.secure_url,
        publicId: result.public_id,
      });
    }

    /*
     * Atomically check that the product still has enough room
     * for all newly uploaded images before adding them.
     *
     * This protects us from two concurrent requests both seeing
     * available image slots and pushing the product beyond 6 images.
     */
    const product = await Product.findOneAndUpdate(
      {
        _id: id,

        $expr: {
          $lte: [
            {
              $add: [
                { $size: "$images" },
                uploadedImages.length,
              ],
            },
            MAX_PRODUCT_IMAGES,
          ],
        },
      },
      {
        $push: {
          images: {
            $each: uploadedImages,
          },
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    );

    /*
     * Product was not updated.
     *
     * This can happen because:
     * - product doesn't exist
     * - product doesn't have enough remaining image slots
     */
    if (!product) {
      await Promise.allSettled(
        uploadedImages.map((image) =>
          deleteImage(image.publicId)
        )
      );

      const existingProduct = await Product.exists({
        _id: id,
      });

      if (!existingProduct) {
        return res.status(404).json({
          success: false,
          message: "Product not found.",
        });
      }

      return res.status(409).json({
        success: false,
        message: `The product cannot have more than ${MAX_PRODUCT_IMAGES} images.`,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product images added successfully.",
      product,
    });
  } catch (error) {
    console.error("Add product images error:", error);

    /*
     * If Cloudinary uploads succeeded but MongoDB failed,
     * clean up the newly uploaded Cloudinary assets.
     */
    if (uploadedImages.length > 0) {
      await Promise.allSettled(
        uploadedImages.map((image) =>
          deleteImage(image.publicId)
        )
      );
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Product image validation failed.",
        errors: Object.values(error.errors).map(
          (validationError) => validationError.message
        ),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// Delete a Product Image
export const deleteProductImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID.",
      });
    }

    if (!mongoose.isValidObjectId(imageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid image ID.",
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    const image = product.images.id(imageId);

    if (!image) {
      return res.status(404).json({
        success: false,
        message: "Product image not found.",
      });
    }

    /*
     * Active products must always have at least one image.
     */
    if (product.isActive && product.images.length <= 1) {
      return res.status(409).json({
        success: false,
        message:
          "An active product must have at least one image.",
      });
    }

    /*
     * Remove the image from MongoDB first.
     *
     * This keeps the database as the source of truth for what
     * images belong to the product.
     */
    product.images.pull(imageId);

    await product.save();

    /*
     * Now remove the corresponding Cloudinary asset.
     *
     * If this fails, the product remains correctly updated in
     * MongoDB, but Cloudinary may temporarily contain an orphaned
     * asset. We log the failure so it can be cleaned up.
     */
    try {
      await deleteImage(image.publicId);
    } catch (cloudinaryError) {
      console.error(
        "Cloudinary image cleanup failed:",
        {
          productId: id,
          imageId,
          publicId: image.publicId,
          error: cloudinaryError,
        }
      );

      return res.status(200).json({
        success: true,
        message:
          "Image removed from the product, but Cloudinary cleanup failed. The asset requires cleanup.",
        product,
        cleanupWarning: true,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product image deleted successfully.",
      product,
    });
  } catch (error) {
    console.error("Delete product image error:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Product validation failed.",
        errors: Object.values(error.errors).map(
          (validationError) => validationError.message
        ),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};