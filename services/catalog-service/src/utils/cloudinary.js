import cloudinary from "../config/cloudinary.js";

export const uploadImage = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        folder: "ecommerce-platform/products",
        ...options,
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        return resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
};

export const deleteImage = async (publicId) => {
  if (!publicId) {
    return;
  }

  return cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    type: "upload",
    invalidate: true,
  });
};