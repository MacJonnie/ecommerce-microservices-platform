import dns from "node:dns";
import "dotenv/config";

dns.setServers(["8.8.8.8", "8.8.4.4"]);


import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";

import { connectDB } from "./config/db.js";
import cartRoutes from "./routes/cartRoutes.js";
import internalCartRoutes from "./routes/internalCartRoutes.js";

const app = express();
const port = Number(process.env.PORT || 3003);

let server;

app.disable("x-powered-by");

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// Health check endpoint.
app.get("/health", (_req, res) => {
  return res.status(200).json({
    success: true,
    service: "cart-service",
    status: "ok",
  });
});

// Cart API routes.
app.use("/api/cart", cartRoutes);
// Internal service communication
app.use("/internal/carts", internalCartRoutes);


// Handle unknown routes.
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Route not found.",
  });
});

// Centralized error-handling middleware.
app.use((err, _req, res, _next) => {
  console.error("Cart Service error:", err);

  return res.status(err.statusCode || 500).json({
    success: false,
    message: err.statusCode
      ? err.message
      : "Internal server error.",
  });
});

// Connect to the database before starting the server.
try {
  await connectDB();

  server = app.listen(port, () => {
    console.info(`Cart Service listening on ${port}`);
  });
} catch (error) {
  console.error("Cart Service startup failed:", error);
  process.exit(1);
}

// Gracefully shut down the server and database connection.
async function shutdown(signal) {
  console.info(`${signal} received; shutting down Cart Service`);

  if (!server) {
    await mongoose.disconnect();
    process.exit(0);
  }

  server.close(async () => {
    try {
      await mongoose.disconnect();
      process.exit(0);
    } catch (error) {
      console.error("Error disconnecting from MongoDB:", error);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error("Graceful shutdown timed out.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
