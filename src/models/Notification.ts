import { DataTypes, Model, type ForeignKey } from "sequelize";

import { sequelize } from "../db/index.js";
import type { Session } from "./Session.js";

/**
 * An in-app notification for the provider. Created out-of-band from the request/
 * response cycle — e.g. when a post-call transcript finishes processing — and polled
 * by the UI so the provider learns the transcript is ready without watching the call.
 */
export type NotificationType = "transcript_ready";

export class Notification extends Model {
  declare id: string;
  declare sessionId: ForeignKey<Session["id"]>;
  declare type: NotificationType;
  declare title: string;
  declare body: string;
  declare read: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Notification.init(
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
      type: DataTypes.ENUM("transcript_ready"),
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    body: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
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
    tableName: "notifications",
    timestamps: true,
  }
);
