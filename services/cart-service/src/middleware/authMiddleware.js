
import jwt from "jsonwebtoken";

// Middleware responsible for authenticating incoming requests.
const authMiddleware = (req, res, next) => {
  try {
    // Retrieve the Authorization header.
    const authHeader = req.headers.authorization;

    // Prefer the Bearer token from the Authorization header.
    // Fall back to the accessToken cookie if no Bearer token exists.
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : req.cookies?.accessToken;

    // Reject requests without an authentication token.
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in.",
      });
    }

    // Ensure the JWT access secret is configured.
    if (!process.env.JWT_ACCESS_SECRET) {
      console.error("JWT_ACCESS_SECRET is not configured.");

      return res.status(500).json({
        success: false,
        message: "Authentication configuration error.",
      });
    }

    // Verify the token's signature and expiration.
    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET
    );

    // Attach authenticated user information to the request.
    // Subsequent controllers and middleware can access req.user.
    req.user = {
      userId: decoded.userId,
      role: decoded.role,
    };

    // Continue to the next middleware or route handler.
    return next();
  } catch (error) {
    // Log authentication failures for debugging.
    console.error("Authentication error:", error);

    // Reject invalid, expired, or otherwise unverifiable tokens.
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token.",
    });
  }
};

// Export the middleware for reuse across protected routes.
export default authMiddleware;
