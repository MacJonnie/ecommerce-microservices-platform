
import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";



// Register User Controller
export const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Check that all fields are provided
        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Please provide name, email, and password.",
            });
        }

        // Check if the email already exists
        const existingUser = await User.findOne({ email });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "A user with this email already exists.",
            });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Create the user
        const user = await User.create({
            name,
            email,
            password: hashedPassword, // SecurePass123!
        });

        // Return safe user details
        return res.status(201).json({
            success: true,
            message: "User registered successfully.",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                date: user.timestamps
            },
        });

    } catch (error) {
        console.error("Registration error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error.",
        });
    }
};


// Login User Controller
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password.",
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase().trim(), }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // Check if the user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated.",
      });
    }

    // Compare password with stored hash
    const passwordMatches = await bcrypt.compare( password, user.password );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // Ensure JWT secret exists
    if (!process.env.JWT_ACCESS_SECRET) {
      throw new Error("JWT_ACCESS_SECRET is not configured.");
    }

    // Generate accessToken JWT
    const accessToken = jwt.sign(
      {
        userId: user._id.toString(),
        role: user.role,
      },
      process.env.JWT_ACCESS_SECRET,
      {
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
      }
    );

    // console.log(
    //   "Refresh secret loaded:",
    //   !!process.env.JWT_REFRESH_SECRET
    // );

    // Generate refreshToken
    const refreshToken = jwt.sign(
        {
          userId: user._id.toString(),
        },
        process.env.JWT_REFRESH_SECRET,
        {
          expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
        }
    );

    // Store JWT in an HTTP-only cookie
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 15 * 60 * 1000,
      path: "/",
    });

    // Store refreshToken in HTTP-only cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/api/users",
    });
   

    // Respond with the accessToken in JSON
    return res.status(200).json({
      success: true,
      message: "Login successful.",
      accessToken: accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// Logout User Controller
export const logoutUser = (req, res) => {
  res.clearCookie("accessToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/users",
  });

  return res.status(200).json({
    success: true,
    message: "Logged out successfully.",
  });
};


// Get User Profile 
export const getUserProfile = async (req, res) => {
  try {
    // Get the authenticated user's ID from the JWT
    const userId = req.user.userId;

    // Fetch the user's current data from MongoDB
    const user = await User.findById(userId)
      .select("-password");

    // Check if the user still exists
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Return the current user profile
    return res.status(200).json({
      success: true,
      message: "User profile retrieved successfully.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("Profile retrieval error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// Updating User (name & email) Controller

export const updateUserProfile = async (req, res) => {
  try {
    // Get the authenticated user's ID
    const userId = req.user.userId;

    // Extract only the fields we allow users to update
    const { name, email } = req.body;

    // Ensure at least one field was provided
    if (name === undefined && email === undefined) {
      return res.status(400).json({
        success: false,
        message: "Please provide a name or email to update.",
      });
    }

    // Build an update object using allowed fields only
    const updates = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Name must be a non-empty string.",
        });
      }

      updates.name = name.trim();
    }

    if (email !== undefined) {
      if (
        typeof email !== "string" ||
        !email.trim() ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid email address.",
        });
      }

      updates.email = email.trim().toLowerCase();
    }

    // Update the authenticated user's record
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password");

    // Check whether the user exists
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Return the updated profile
    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    // Handle MongoDB duplicate email error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    console.error("Profile update error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// Change User Password
export const changePassword = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide your current and new password.",
      });
    }

    // Validate the new password
    if (
      typeof newPassword !== "string" ||
      newPassword.length < 8
    ) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters.",
      });
    }

    // Retrieve the user, including the hidden password
    const user = await User.findById(userId).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Verify the current password
    const isPasswordCorrect = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Save the new password
    user.password = hashedPassword;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (error) {
    console.error("Password change error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};



// Get Users (Amin route)
export const getAllUsers = async (req, res) => {
  try {
    const page = Math.max(
      1,
      parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 10)
    );

    const skip = (page - 1) * limit;

    // Read search and role from the URL
    const search = req.query.search?.trim();
    const role = req.query.role?.trim();

    // Build a MongoDB filter
    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    if (role) {
      if (!["customer", "admin"].includes(role)) {
        return res.status(400).json({
          success: false,
          message: "Invalid role. Use customer or admin.",
        });
      }

      filter.role = role;
    }

    // Fetch matching users for this page
    const users = await User.find(filter)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Count only matching users
    const totalUsers = await User.countDocuments(filter);

    return res.status(200).json({
      success: true,
      page,
      limit,
      totalUsers,
      totalPages: Math.ceil(totalUsers / limit),
      users,
    });
  } catch (error) {
    console.error("Get all users error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// Get User By ID
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate the MongoDB ObjectId
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    const user = await User.findById(id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get user by ID error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// Delete User
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate the MongoDB ID
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    const user = await User.findByIdAndDelete(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User deleted successfully.",
    });
  } catch (error) {
    console.error("Delete user error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// Admin user update
export const adminUpdateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    if (name === undefined && email === undefined) {
      return res.status(400).json({
        success: false,
        message: "Please provide a name or email to update.",
      });
    }

    const updates = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Name must be a non-empty string.",
        });
      }

      updates.name = name.trim();
    }

    if (email !== undefined) {
      if (
        typeof email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid email address.",
        });
      }

      updates.email = email.trim().toLowerCase();
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User updated successfully.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    console.error("Admin update user error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// Admin user role change
export const updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    if (!["customer", "admin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role must be customer or admin.",
      });
    }

    if (req.user.userId === id) {
      return res.status(403).json({
        success: false,
        message: "You cannot change your own role.",
      });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { role } },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User role updated successfully.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Update user role error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// Admin user status update
export const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean.",
      });
    }

    if (req.user.userId === id) {
      return res.status(403).json({
        success: false,
        message: "You cannot deactivate your own account.",
      });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { isActive } },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `User account ${
        isActive ? "activated" : "deactivated"
      } successfully.`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    console.error("Update user status error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// refresh access token
export const refreshAccessToken = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;


    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token is required.",
      });
    }

    if (!process.env.JWT_REFRESH_SECRET) {
      console.error("JWT_REFRESH_SECRET is not configured.");

      return res.status(500).json({
        success: false,
        message: "Authentication configuration error.",
      });
    }

    console.log(
      "Refresh secret loaded:",
      !!process.env.JWT_REFRESH_SECRET
    );
    
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET
    );

    const user = await User.findById(decoded.userId)
      .select("_id role isActive");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User account no longer exists.",
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated.",
      });
    }

    const newAccessToken = jwt.sign(
      {
        userId: user._id.toString(),
        role: user.role,
      },
      process.env.JWT_ACCESS_SECRET,
      {
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
      }
    );

    res.cookie("accessToken", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 15 * 60 * 1000,
      path: "/",
    });

    return res.status(200).json({
      success: true,
      message: "Access token refreshed successfully.",
      token: newAccessToken,
    });
  } catch (error) {
    console.error("Refresh token error:", error);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token.",
    });
  }
};