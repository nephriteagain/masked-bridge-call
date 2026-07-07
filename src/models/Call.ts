import { DataTypes, Model, type ForeignKey } from "sequelize";

import { sequelize } from "../db/index.js";
import type { Session } from "./Session.js";

export type CallStatus =
  | "queued"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "no-answer"
  | "failed"
  | "canceled";

export type CallLeg = "A" | "B";

export class Call extends Model {
  declare id: string;
  declare sessionId: ForeignKey<Session["id"]>;
  declare callSid: string;
  declare leg: CallLeg;
  declare partyNumber: string;
  declare status: CallStatus;
  declare answeredBy: string | null;
  declare direction: "inbound" | "outbound";
  declare createdAt: Date;
  declare updatedAt: Date;
}

Call.init(
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
    callSid: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: "Twilio Call SID",
    },
    leg: {
      type: DataTypes.ENUM("A", "B"),
      allowNull: false,
      comment: "Which party this call is for (A or B)",
    },
    partyNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Phone number of the party",
    },
    status: {
      type: DataTypes.ENUM(
        "queued",
        "ringing",
        "in-progress",
        "completed",
        "busy",
        "no-answer",
        "failed",
        "canceled"
      ),
      allowNull: false,
    },
    answeredBy: {
      type: DataTypes.STRING,
      allowNull: true,
      comment:
        "machine_start | machine_end | human | fax | unknown (from answering machine detection)",
    },
    direction: {
      type: DataTypes.ENUM("inbound", "outbound"),
      allowNull: false,
      comment: "Whether the call is inbound or outbound",
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
    tableName: "calls",
    timestamps: true,
  }
);
