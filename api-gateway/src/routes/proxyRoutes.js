
import {
  createProxyMiddleware,
  fixRequestBody,
} from "http-proxy-middleware";

import services from "../config/services.js";

// Shared proxy configuration used by all microservices.
const commonProxyOptions = {
  // Change the origin header to match the target service.
  changeOrigin: true,

  on: {
    // Fix the request body when proxying requests.
    proxyReq: fixRequestBody,

    // Handle errors encountered while communicating with services.
    error: (error, req, res) => {
      console.error("Gateway proxy error:", {
        method: req.method,
        url: req.originalUrl,
        error: error.message,
      });

      // Return a service-unavailable response if headers
      // have not already been sent to the client.
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          message: "Service temporarily unavailable.",
        });
      }
    },

    // Log the response status returned by the target service.
    proxyRes: (proxyRes, req) => {
      console.log(
        `[Gateway] ${req.method} ${req.originalUrl} -> ${proxyRes.statusCode}`
      );
    },
  },
};

// User Service proxy.
// Forward requests to the User Service with the /api/users prefix.
export const userServiceProxy = createProxyMiddleware({
  target: services.userService,

  ...commonProxyOptions,

  pathRewrite: (path) => {
    return `/api/users${path}`;
  },
});

// Catalog Service proxy.
// Forward requests to the Catalog Service with the /api/products prefix.
export const catalogServiceProxy = createProxyMiddleware({
  target: services.catalogService,

  ...commonProxyOptions,

  pathRewrite: (path) => {
    return `/api/products${path}`;
  },
});

// Cart Service proxy.
// Forward requests to the Cart Service with the /api/cart prefix.
export const cartServiceProxy = createProxyMiddleware({
  target: services.cartService,

  ...commonProxyOptions,

  pathRewrite: (path) => {
    return `/api/cart${path}`;
  },
});

// Order Service proxy.
// Forward requests to the Order Service with the /api/orders prefix.
export const orderServiceProxy = createProxyMiddleware({
  target: services.orderService,

  ...commonProxyOptions,

  pathRewrite: (path) => {
    return `/api/orders${path}`;
  },
});
