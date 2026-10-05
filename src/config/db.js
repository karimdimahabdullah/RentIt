import mongoose from 'mongoose';

export async function connectDB(uri = process.env.MONGODB_URI) {
  await mongoose.connect(uri);
  console.log('DataBase connected');
  return mongoose.connection;
}
