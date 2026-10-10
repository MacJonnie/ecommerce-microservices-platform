import express from "express";
import { 
    registerUser,
    loginUser,
    logoutUser,
    getUserProfile,
    updateUserProfile,
    changePassword,
    getAllUsers,
    getUserById,
    deleteUser,
    adminUpdateUser,
    updateUserRole,
    updateUserStatus,
    refreshAccessToken
} from "../controllers/userController.js";

import authMiddleware from "../middleware/authMiddleware.js";
import authorizeRoles from "../middleware/roleMiddleware.js"

const router = express.Router();

// Public Routes
router.post("/register", registerUser); // Register

router.post("/login", loginUser); // Login

router.post("/refresh-token", refreshAccessToken); // refresh token

router.post("/logout", logoutUser); // Logout



// Protected Route
router.get("/profile", authMiddleware, getUserProfile) // Get Logged in User Profile

router.patch("/profile", authMiddleware, updateUserProfile); // Edit User Profile

router.patch("/change-password", authMiddleware, changePassword); // Change Password


// Admin Only Routes
router.get("/", authMiddleware, authorizeRoles("admin"), getAllUsers ) // retrieve, search, filter, and paginate users
router.get("/:id", authMiddleware, authorizeRoles("admin"), getUserById ); // get users by ID

router.delete("/:id", authMiddleware, authorizeRoles("admin"), deleteUser ); // Delete user

router.patch("/:id", authMiddleware, authorizeRoles("admin"), adminUpdateUser ); // Update User Profile by Admin

router.patch("/:id/role", authMiddleware, authorizeRoles("admin"), updateUserRole ); // Update User Role

router.patch("/:id/status", authMiddleware, authorizeRoles("admin"), updateUserStatus ); // Update User Active Status.


export default router;