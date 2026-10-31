import dns from "node:dns";
import "dotenv/config";

dns.setServers(["8.8.8.8", "8.8.4.4"]);


import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";

import { connectDB } from "./config/db.js";
import orderRoutes from "./routes/orderRoutes.js";

const app = express();

app.disable("x-powered-by");

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.get("/health", (_req, res) =>
  res.json({
    success: true,
    service: "order-service",
    status: "ok",
  })
);

app.use("/api/orders", orderRoutes);

app.use((req, res) =>
  res.status(404).json({
    success: false,
    message: "Route not found.",
  })
);

app.use((err, _req, res, _next) => {
  console.error("Order Service error:", err);

  res.status(err.statusCode || 500).json({
    success: false,
    message:
      err.statusCode && err.statusCode < 500
        ? err.message
        : "Internal server error.",
  });
});

const port = Number(process.env.PORT || 3004);

let server;

try {
  await connectDB();

  server = app.listen(port, () =>
    console.info(`Order Service listening on ${port}`)
  );
} catch (e) {
  console.error("Order Service startup failed:", e);
  process.exit(1);
}

async function shutdown(signal) {
  console.info(`${signal} received; shutting down Order Service`);

  server?.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
;;