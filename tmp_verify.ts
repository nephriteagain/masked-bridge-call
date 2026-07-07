import { initializeDatabase, closeDatabase } from "./src/db/index.js";
import "./src/models/index.js";
import { sessionRepository, callRepository } from "./src/repositories/index.js";
import * as callService from "./src/services/call.service.js";
import { Call } from "./src/models/index.js";

await initializeDatabase();

const session = await sessionRepository.createSession({ partyA: "+15550000001", partyB: "+15550000002" });
console.log("session:", session.id);

// Simulate A-leg lifecycle status callbacks (incl. Twilio's "initiated").
await callService.handleCallStatus(session.id, "initiated", "CAtestA");
await callService.handleCallStatus(session.id, "ringing", "CAtestA");

// Simulate A answering (bridge) — human answer.
await callService.buildBridgeTwiml(session.id, "CAtestA", undefined);

// Simulate the <Dial> to B completing.
await callService.handleDialStatus(session.id, "completed", "CAtestB");

// Simulate final A-leg completion.
await callService.handleCallStatus(session.id, "completed", "CAtestA");

const legs = await Call.findAll({ where: { sessionId: session.id }, order: [["leg", "ASC"]] });
console.log("=== calls table rows ===");
for (const c of legs) {
  console.log({ leg: c.leg, callSid: c.callSid, status: c.status, partyNumber: c.partyNumber, direction: c.direction });
}

// cleanup
await sessionRepository.deleteSession(session.id);
console.log("=== cleaned up, session + cascaded calls deleted ===");
console.log("remaining rows for session:", await Call.count({ where: { sessionId: session.id } }));

await closeDatabase();
