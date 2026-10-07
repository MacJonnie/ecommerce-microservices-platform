import {
  createProxyMiddleware,
  fixRequestBody,
} from "http-proxy-middleware";

import services from "../config/services.js";

const commonProxyOptions = {
  changeOrigin: true,

  on: {
    proxyReq: fixRequestBody,

    error: (error, req, res) => {
      console.error("Gateway proxy error:", {
        method: req.method,
        url: req.originalUrl,
        error: error.message,
      });

      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          message: "Service temporarily unavailable.",
        });
      }
    },

    proxyRes: (proxyRes, req) => {
      console.log(
        `[Gateway] ${req.method} ${req.originalUrl} -> ${proxyRes.statusCode}`
      );
    },
  },
};

// User Service
export const userServiceProxy = createProxyMiddleware({
  target: services.userService,

  ...commonProxyOptions,

  pathRewrite: (path) => {
    return `/api/users${path}`;
  },
});

// Catalog Service
export const catalogServiceProxy = createProxyMiddleware({
  target: services.catalogService,

  ...commonProxyOptions,

  pathRewrite: (path) => {
    return `/api/products${path}`;
  },
});