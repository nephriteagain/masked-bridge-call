import { DataTypes, Model, type ForeignKey } from "sequelize";

import { sequelize } from "../db/index.js";
import type { Session } from "./Session.js";

/**
 * A single timestamped entry in a session's activity log. Every meaningful step of
 * the Call Connect flow (heads-up text, ringing, connected, declined, canceled,
 * ended, transcript ready, …) is appended here so the provider can see exactly what
 * happened, in order. Phone-side only in this POC — video events would be appended
 * here too in the real app.
 */
export type EventParty = "provider" | "client" | "system";

export class Event extends Model {
  declare id: string;
  declare sessionId: ForeignKey<Session["id"]>;
  declare type: string;
  declare party: EventParty | null;
  declare message: string | null;
  declare metadata: Record<string, unknown>;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Event.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    sessionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "sessions", key: "id" },
      onDelete: "CASCADE",
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Event type, e.g. heads_up_text_sent, client_answered, call_ended",
    },
    party: {
      type: DataTypes.ENUM("provider", "client", "system"),
      allowNull: true,
      comment: "Which party the event concerns (null = not party-specific)",
    },
    message: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Human-readable description for display",
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: "Arbitrary structured detail (callSid, dialStatus, …)",
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
    tableName: "events",
    timestamps: true,
  }
);
