import "dotenv/config";

import express from "express";
import helmet from "helmet";
import mongoose from "mongoose";

import notificationRoutes from "./routes/notificationRoutes.js";
import { retryFailed } from "./controllers/notificationController.js";

const app = express();
const port = Number(process.env.PORT || 3006);

// Add standard security headers and limit incoming JSON payloads.
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

// Health endpoint is intentionally public for container monitoring.
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "notification-service",
    status: "ok",
  });
});

// All notification enqueue operations require internal service authentication.
app.use("/internal/notifications", notificationRoutes);

// Central error handler. Do not expose SMTP/database internals to callers.
app.use((error, _req, res, _next) => {
  console.error("Notification Service error:", error);
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode && error.statusCode < 500
      ? error.message
      : "Notification Service error.",
  });
});

let server;
let retryTimer;

try {
  if (!process.env.MONGODB_CONNECTION) {
    throw new Error("MONGODB_CONNECTION is not configured.");
  }

  await mongoose.connect(process.env.MONGODB_CONNECTION);

  server = app.listen(port, () => {
    console.info(`Notification Service listening on ${port}`);
  });

  // Retry queued/failed notifications every minute.
  retryTimer = setInterval(() => {
    retryFailed().catch((error) =>
      console.error("Notification retry batch failed:", error)
    );
  }, 60000);
  retryTimer.unref();
} catch (error) {
  console.error("Notification Service startup failed:", error);
  process.exit(1);
}

async function shutdown(signal) {
  console.info(`${signal} received; shutting down Notification Service`);
  clearInterval(retryTimer);

  server?.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
