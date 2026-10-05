import dns from "node:dns";
import "dotenv/config";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import productRoutes from "./routes/productRoutes.js";
import connectDB from "./config/db.js";
import errorMiddleware from "./middleware/errorMiddleware.js";


const app = express();

const PORT = process.env.PORT || 3002;


// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());
 
// Connect to database
await connectDB();

// Health check
app.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,
    service: "catalog-service",
    message: "Catalog Service is running.",
  });
});

// Product Routes
app.use("/api/products", productRoutes)

// Error handler
app.use(errorMiddleware);

// Start server
app.listen(PORT, () => {
  console.log(`Catalog Service running on port ${PORT}`);
});