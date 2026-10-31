import mongoose from "mongoose";

const itemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
    },
  },
  {
    _id: false,
  }
);

const schema = new mongoose.Schema(
  {
    reservationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    items: {
      type: [itemSchema],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "reserving",
        "reserved",
        "releasing",
        "released",
        "failed",
      ],
      required: true,
      index: true,
    },
    lastError: String,
    releasedAt: Date,
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export default mongoose.model("InventoryReservation", schema);