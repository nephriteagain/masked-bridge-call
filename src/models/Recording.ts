import { DataTypes, Model, type ForeignKey } from "sequelize";

import { sequelize } from "../db/index.js";
import type { Session } from "./Session.js";

export type RecordingStatus = "queued" | "processing" | "completed" | "failed";

export class Recording extends Model {
  declare id: string;
  declare sessionId: ForeignKey<Session["id"]>;
  declare recordingSid: string;
  declare duration: number | null;
  declare channels: number;
  declare status: RecordingStatus;
  declare url: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Recording.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    sessionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "sessions",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    recordingSid: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: "Twilio Recording SID",
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Duration of recording in seconds",
    },
    channels: {
      type: DataTypes.INTEGER,
      defaultValue: 2,
      comment: "Number of channels (1 = mono, 2 = dual channel A/B)",
    },
    status: {
      type: DataTypes.ENUM("queued", "processing", "completed", "failed"),
      defaultValue: "queued",
      allowNull: false,
    },
    url: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Twilio media URL for the recording",
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: "recordings",
    timestamps: true,
  }
);
