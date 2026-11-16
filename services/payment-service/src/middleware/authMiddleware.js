
/**
 * Authenticate requests originating from trusted internal services.
 *
 * The requesting service must provide the shared internal token
 * through the x-internal-service-token HTTP header.
 */
export default function internalAuth(req, res, next) {
  // Ensure the internal token is configured and matches the request.
  if (
    !process.env.INTERNAL_SERVICE_TOKEN ||
    req.get("x-internal-service-token") !==
      process.env.INTERNAL_SERVICE_TOKEN
  ) {
    // Reject requests that fail internal authentication.
    return res.status(401).json({
      success: false,
      message: "Unauthorized internal request",
    });
  }

  // Allow the request to continue when authentication succeeds.
  next();
}
