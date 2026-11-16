import "dotenv/config";

import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";

import paymentRoutes from "./routes/paymentRoutes.js";
import { webhook } from "./controllers/paymentController.js";

const app = express();
const port = Number(process.env.PORT || 3005);

app.disable("x-powered-by");
app.use(helmet());
app.use(cookieParser());

// Paystack needs the unparsed body to verify its HMAC signature.
// This endpoint must be mounted before express.json().
app.post(
  "/webhooks/paystack",
  express.raw({ type: "application/json", limit: "1mb" }),
  webhook
);

// Parse regular API request bodies.
app.use(express.json({ limit: "1mb" }));

// Health endpoint for local and container monitoring.
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "payment-service",
    status: "ok",
  });
});

// Authenticated customer payment routes.
app.use("/api/payments", paymentRoutes);

// Central error handler; avoid returning upstream stack traces.
app.use((error, _req, res, _next) => {
  console.error("Payment Service error:", error);
  res.status(error.statusCode || error.response?.status || 500).json({
    success: false,
    message: error.statusCode && error.statusCode < 500
      ? error.message
      : "Payment Service error.",
  });
});

let server;
try {
  if (!process.env.MONGODB_CONNECTION) {
    throw new Error("MONGODB_CONNECTION is not configured.");
  }
  if (!process.env.JWT_ACCESS_SECRET) {
    throw new Error("JWT_ACCESS_SECRET is not configured.");
  }
  if (!process.env.INTERNAL_SERVICE_TOKEN) {
    throw new Error("INTERNAL_SERVICE_TOKEN is not configured.");
  }
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  }

  await mongoose.connect(process.env.MONGODB_CONNECTION);

  server = app.listen(port, () => {
    console.info(`Payment Service listening on ${port}`);
  });
} catch (error) {
  console.error("Payment Service startup failed:", error);
  process.exit(1);
}

async function shutdown(signal) {
  console.info(`${signal} received; shutting down Payment Service`);
  server?.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
