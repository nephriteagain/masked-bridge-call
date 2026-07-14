import { Session } from "./Session.js";
import { Call } from "./Call.js";
import { Recording } from "./Recording.js";
import { Transcript } from "./Transcript.js";
import { Event } from "./Event.js";
import { Notification } from "./Notification.js";

/**
 * Model associations are declared here, in one place, rather than scattered across
 * the individual model files. This keeps the relationship graph easy to reason about
 * and avoids import-order surprises between models.
 *
 *   Session (1) ──┬─── (N) Call
 *                 ├─── (1) Recording
 *                 ├─── (1) Transcript
 *                 ├─── (N) Event
 *                 └─── (N) Notification
 */
Session.hasMany(Call, { foreignKey: "sessionId", as: "calls" });
Call.belongsTo(Session, { foreignKey: "sessionId", as: "session" });

Session.hasOne(Recording, { foreignKey: "sessionId", as: "recording" });
Recording.belongsTo(Session, { foreignKey: "sessionId", as: "session" });

Session.hasOne(Transcript, { foreignKey: "sessionId", as: "transcript" });
Transcript.belongsTo(Session, { foreignKey: "sessionId", as: "session" });

Session.hasMany(Event, { foreignKey: "sessionId", as: "events" });
Event.belongsTo(Session, { foreignKey: "sessionId", as: "session" });

Session.hasMany(Notification, { foreignKey: "sessionId", as: "notifications" });
Notification.belongsTo(Session, { foreignKey: "sessionId", as: "session" });

export { Session, Call, Recording, Transcript, Event, Notification };
export type { SessionStatus, CiTranscriptLine } from "./Session.js";
export type { CallStatus, CallLeg } from "./Call.js";
export type { RecordingStatus } from "./Recording.js";
export type { TranscriptStatus } from "./Transcript.js";
export type { EventParty } from "./Event.js";
export type { NotificationType } from "./Notification.js";
