import { DataTypes, Model } from "sequelize";

import { sequelize } from "../db/index.js";

export type SessionStatus =
  | "initiated"
  | "ringing-a"
  | "bridging"
  | "connected"
  | "completed"
  | "failed"
  | "canceled"
  | "declined";

export interface CiTranscriptLine {
  speaker: "A" | "B";
  text: string;
  confidence: number | null;
}

export class Session extends Model {
  declare id: string;
  declare partyA: string;
  declare partyB: string;
  declare status: SessionStatus;
  declare callSid: string | null;
  declare recordingSid: string | null;
  declare transcriptSid: string | null;
  declare ciTranscript: CiTranscriptLine[];
  declare connectedAt: Date | null;
  declare endedAt: Date | null;
  declare endReason: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Session.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    partyA: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Real phone number of Party A (never exposed to Party B)",
    },
    partyB: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Real phone number of Party B (never exposed to Party A)",
    },
    status: {
      type: DataTypes.ENUM(
        "initiated",
        "ringing-a",
        "bridging",
        "connected",
        "completed",
        "failed",
        "canceled",
        "declined"
      ),
      defaultValue: "initiated",
      allowNull: false,
    },
    callSid: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Twilio Call SID for the initial call to Party A",
    },
    recordingSid: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Twilio Recording SID for dual-channel recording",
    },
    transcriptSid: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Twilio Conversation Intelligence Transcript SID",
    },
    ciTranscript: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: "Post-call transcript with speaker labels and confidence scores",
    },
    connectedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "When BOTH parties were connected (basis for the live call timer)",
    },
    endedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "When the call reached a terminal state",
    },
    endReason: {
      type: DataTypes.STRING,
      allowNull: true,
      comment:
        "Why the call ended: completed | client_declined | provider_canceled | provider_no_answer | failed",
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
    tableName: "sessions",
    timestamps: true,
  }
);
