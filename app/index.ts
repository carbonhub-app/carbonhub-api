// Bun loads .env automatically, so no dotenv bootstrap is needed here.
import { connectDB } from "./configs/database/mongodb/mongodb.client";
import app from "./server";

await connectDB();

const PORT = Number(process.env.PORT) || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
