import dns from "node:dns";
import express from "express"
import dotenv from "dotenv"
import connectDB from "./config/db.js"
import userRoutes from "./routes/userRoutes.js";
import cookieParser from "cookie-parser";


dotenv.config();

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const app = express();

app.use(express.json());
app.use(express.urlencoded ({
    extended: true
}))
app.use(cookieParser());

app.use("/api/users", userRoutes);

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "User Service is running",
  });
});

const PORT = process.env.PORT || 3001;

const startServer = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`User Service running on port ${PORT}`);
  });
};

startServer();