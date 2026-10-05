import multer from "multer";

const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

const fileFilter = (req, file, cb) => {
  if (!allowedMimeTypes.has(file.mimetype)) {
    return cb(
      new Error(
        "Invalid image type. Only JPEG, PNG, WebP, and AVIF images are allowed."
      )
    );
  }

  return cb(null, true);
};

const uploadProductImages = multer({
  storage,

  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 6,
  },

  fileFilter,
});

export default uploadProductImages;