import multer from "multer";

const errorMiddleware = (error, req, res, next) => {
  console.error("Unhandled error:", error);

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "Each image must not exceed 5 MB.",
      });
    }

    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        message: "You can upload a maximum of 6 images.",
      });
    }

    return res.status(400).json({
      success: false,
      message: "Image upload validation failed.",
    });
  }

  if (
    error.message?.includes(
      "Invalid image type"
    )
  ) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error.",
  });
};

export default errorMiddleware;