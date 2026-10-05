import mongoose from "mongoose";
import dotenv from "dotenv"

dotenv.config()

const connectDB = async () => {
    const DB_CONNECTION = process.env.MONGODB_CONNECTION;

    if (!DB_CONNECTION) {
        console.error("MongoDB connection string is not defined in the environment variables.");
        return
    }

    try{
        await mongoose.connect(DB_CONNECTION)
        console.log("Connected to MongoDB");
    } catch(error) {
        console.log("Error connecting to MongoDB:", error);
        process.exit(1);
    } 
}


export default connectDB;