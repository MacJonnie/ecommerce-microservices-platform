import mongoose from "mongoose";
import User from "../models/User.js";

/** Return only the minimum user fields required by trusted services. */
export async function getInternalUser(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    const user = await User.findById(req.params.id)
      .select("_id name email isActive")
      .lean();

    if (!user || user.isActive === false) {
      return res.status(404).json({
        success: false,
        message: "User not found or inactive.",
      });
    }

    return res.json({
      success: true,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    return next(error);
  }
}
