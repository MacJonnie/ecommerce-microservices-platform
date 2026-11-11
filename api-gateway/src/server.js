
import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import {
  userServiceProxy,
  catalogServiceProxy,
  cartServiceProxy,
  orderServiceProxy,
} from "./routes/proxyRoutes.js";

import errorMiddleware from "./middleware/errorMiddleware.js";

const app = express();

const PORT = process.env.PORT || 3000;

// Security headers.
app.use(helmet());

// Cross-Origin Resource Sharing (CORS).
// Allows requests from the configured frontend origin
// and supports credentials such as authentication cookies.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  })
);

// Rate limiting.
// Restricts the number of requests a client can make
// within a 15-minute window.
const gatewayRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: "draft-8",
  legacyHeaders: false,

  // Response returned when the rate limit is exceeded.
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

app.use(gatewayRateLimiter);

/**
 * Body parsing.
 *
 * Important:
 * express.json() does not interfere with multipart/form-data
 * because it only parses JSON requests.
 *
 * JSON parsing remains disabled here.
 */
// app.use(express.json({ limit: "1mb" }));

// Gateway health check.
// Used to verify that the API Gateway is running.
app.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,
    service: "api-gateway",
    message: "API Gateway is running.",
  });
});

// User Service.
// Forward requests beginning with /api/users.
app.use(
  "/api/users",
  userServiceProxy
);

// Catalog Service.
// Forward requests beginning with /api/products.
app.use(
  "/api/products",
  catalogServiceProxy
);

// Cart Service.
// Forward requests beginning with /api/cart.
app.use(
  "/api/cart",
  cartServiceProxy
);

// Order Service.
// Forward requests beginning with /api/orders.
app.use(
  "/api/orders",
  orderServiceProxy
);

// Unknown route handler.
// Returns 404 when no registered gateway route matches.
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Gateway route not found.",
  });
});

// Centralized error-handling middleware.
app.use(errorMiddleware);

// Start the API Gateway server.
const server = app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});

// Graceful shutdown.
// Stops accepting new connections and waits for
// existing connections to close before exiting.
const shutdown = (signal) => {
  console.log(`${signal} received. Shutting down API Gateway...`);

  server.close(() => {
    console.log("API Gateway shut down successfully.");
    process.exit(0);
  });
};

// Handle termination signals.
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
