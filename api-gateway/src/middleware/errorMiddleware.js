const errorMiddleware = (error, req, res, next) => {
  console.error("Gateway error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    success: false,
    message: "Internal gateway error.",
  });
};

export default errorMiddleware;