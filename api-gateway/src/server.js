import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import {
  userServiceProxy,
  catalogServiceProxy,
} from "./routes/proxyRoutes.js";

import errorMiddleware from "./middleware/errorMiddleware.js";

const app = express();

const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet());

// CORS
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  })
);

// Rate limiting
const gatewayRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: "draft-8",
  legacyHeaders: false,

  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

app.use(gatewayRateLimiter);

/*
 * Body parsing
 *
 * Important:
 * express.json() does not interfere with multipart/form-data
 * because it only parses JSON requests.
 */
// app.use(express.json({ limit: "1mb" }));

// Gateway health check
app.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,
    service: "api-gateway",
    message: "API Gateway is running.",
  });
});

// User Service
app.use(
  "/api/users",
  userServiceProxy
);

// Catalog Service
app.use(
  "/api/products",
  catalogServiceProxy
);

// Unknown route
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Gateway route not found.",
  });
});

// Error middleware
app.use(errorMiddleware);

// Start server
const server = app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`${signal} received. Shutting down API Gateway...`);

  server.close(() => {
    console.log("API Gateway shut down successfully.");
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));