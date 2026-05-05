import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  discordId: string;
  name: string;
  image?: string;
  email?: string;
  clearanceLevel: number; // 0: User, 1: Moderator, 2: Staff, 3: Admin, 4: SuperAdmin
  lastSeenNewsId?: string;
  isStaff: boolean;
  followers: string[]; // Array of discordIds
  following: string[]; // Array of discordIds
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema(
  {
    discordId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    image: { type: String },
    email: { type: String },
    clearanceLevel: { type: Number, default: 0 },
    lastSeenNewsId: { type: String },
    isStaff: { type: Boolean, default: false },
    followers: { type: [String], default: [] },
    following: { type: [String], default: [] },
  },
  { timestamps: true }
);

userSchema.index({ isStaff: 1 });

export const User = mongoose.models.User || mongoose.model<IUser>('User', userSchema);
