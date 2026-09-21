import mongoose from "mongoose";

async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    await mongoose.connection.db!.admin().command({ ping: 1 });
    console.log("MongoDB connected successfully");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
}

async function disconnectDB(): Promise<void> {
  try {
    await mongoose.disconnect();
    console.log("MongoDB disconnected successfully");
  } catch (err) {
    console.error("MongoDB disconnection error:", err);
    process.exit(1);
  }
}

export { connectDB, disconnectDB };
