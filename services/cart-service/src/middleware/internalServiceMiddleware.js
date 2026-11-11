
import crypto from "node:crypto";

export default function internalServiceMiddleware(req, res, next) {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  const received = req.get("x-internal-service-token");

  if (!expected || !received) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized internal service request.",
    });
  }

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized internal service request.",
    });
  }

  next();
}
