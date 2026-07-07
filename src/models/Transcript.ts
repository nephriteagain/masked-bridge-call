import { DataTypes, Model, type ForeignKey } from "sequelize";

import { sequelize } from "../db/index.js";
import type { Session } from "./Session.js";

export type TranscriptStatus = "processing" | "completed" | "failed";

export class Transcript extends Model {
  declare id: string;
  declare sessionId: ForeignKey<Session["id"]>;
  declare transcriptSid: string;
  declare status: TranscriptStatus;
  declare language: string;
  declare sentences: Record<string, unknown>[];
  declare createdAt: Date;
  declare updatedAt: Date;
}

Transcript.init(
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
    transcriptSid: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: "Twilio Conversation Intelligence Transcript SID",
    },
    status: {
      type: DataTypes.ENUM("processing", "completed", "failed"),
      defaultValue: "processing",
      allowNull: false,
    },
    language: {
      type: DataTypes.STRING,
      defaultValue: "en",
      comment: "Language code of the transcript",
    },
    sentences: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: "Array of sentence objects with speaker, text, and confidence",
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
    tableName: "transcripts",
    timestamps: true,
  }
);
