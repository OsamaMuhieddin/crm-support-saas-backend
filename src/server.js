import app from './app.js';
import { env } from './config/env.js';
import { connectDB } from './infra/db/mongoose.js';

const startServer = async () => {
  try {
    await connectDB();
    app.listen(env.PORT, () =>
      console.log(`Server running on port ${env.PORT}`)
    );
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

startServer();
