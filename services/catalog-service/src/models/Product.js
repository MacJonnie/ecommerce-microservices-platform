import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required."],
      trim: true,
      minlength: [2, "Product name must be at least 2 characters."],
      maxlength: [100, "Product name cannot exceed 100 characters."],
    },

    description: {
      type: String,
      required: [true, "Product description is required."],
      trim: true,
      minlength: [10, "Product description must be at least 10 characters."],
      maxlength: [2000, "Product description cannot exceed 2000 characters."],
    },

    price: {
      type: Number,
      required: [true, "Product price is required."],
      min: [0, "Product price cannot be negative."],
    },

    category: {
      type: String,
      required: [true, "Product category is required."],
      trim: true,
      minlength: [2, "Category must be at least 2 characters."],
      maxlength: [50, "Category cannot exceed 50 characters."],
    },

    images: {
      type: [
        {
          url: {
            type: String,
            required: true,
            trim: true,
          },

          publicId: {
            type: String,
            required: true,
            trim: true,
          },
        },
      ],

      default: [],

      validate: {
        validator: (images) => images.length <= 6,
        message: "A product cannot have more than 6 images.",
      },
    },

    sku: {
      type: String,
      required: [true, "SKU is required."],
      unique: true,
      trim: true,
      uppercase: true,
      minlength: [3, "SKU must be at least 3 characters."],
      maxlength: [50, "SKU cannot exceed 50 characters."],
    },

    stock: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "Stock cannot be negative."],
      validate: {
        validator: Number.isInteger,
        message: "Stock must be a whole number.",
      },
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Product creator is required."],
    },
  },
  {
    timestamps: true,
  }
);

const Product = mongoose.model("Product", productSchema);

export default Product;