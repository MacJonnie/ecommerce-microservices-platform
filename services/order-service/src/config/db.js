import mongoose from "mongoose";

export async function connectDB() {
  const DB_CONNECTION = process.env.MONGODB_CONNECTION;
  if (!DB_CONNECTION) throw new Error("MONGODB_CONNECTION is required");

  try{
      await mongoose.connect(DB_CONNECTION, { serverSelectionTimeoutMS: 10000 });
      console.info("Cart Service connected to MongoDB");
  } catch (error) {
      console.error("Error connecting to MongoDB:", error);
      throw error;
  }
}