/**
 * Protect service-only endpoints with the shared internal service token.
 * This middleware must never be applied to public customer routes.
 */
export default function internalAuth(req, res, next) {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  const supplied = req.get("x-internal-service-token");

  if (!expected || supplied !== expected) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized internal request.",
    });
  }

  return next();
}
