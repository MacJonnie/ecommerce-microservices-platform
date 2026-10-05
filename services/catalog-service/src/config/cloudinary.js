import "dotenv/config";
import { v2 as cloudinary } from "cloudinary";

const requiredEnvironmentVariables = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

for (const variable of requiredEnvironmentVariables) {
  if (!process.env[variable]) {
    throw new Error(
      `${variable} is not configured in the environment.`
    );
  }
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default cloudinary;