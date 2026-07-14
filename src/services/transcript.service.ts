import { config } from "../config/index.js";
import {
  sessionRepository,
  recordingRepository,
  transcriptRepository,
  eventRepository,
  notificationRepository,
} from "../repositories/index.js";
import type { CiTranscriptLine } from "../models/index.js";
import { logger } from "../utils/logger.js";
import {
  createTranscript,
  listTranscriptSentences,
} from "./twilio.service.js";

/**
 * Post-call transcription flow: persist the finished recording, request a
 * Conversation Intelligence transcript, then (on the completion webhook) assemble
 * the speaker-labeled transcript and store it against the session.
 */

/** Append an activity-log entry, best-effort (must never fail the transcript flow). */
async function recordEvent(
  sessionId: string,
  type: string,
  message: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await eventRepository.recordEvent({ sessionId, type, party: "system", message, metadata });
  } catch (err) {
    logger.warn("Failed to record event.", { sessionId, type, error: (err as Error).message });
  }
}

/**
 * The dual-channel recording is ready. Persist it and kick off transcription.
 * Safe to call before responding to Twilio; runs fire-and-forget after the ack.
 */
export async function handleRecordingReady(
  sessionId: string,
  recordingSid: string
): Promise<void> {
  await sessionRepository.updateSession(sessionId, { recordingSid });
  await recordingRepository.createRecording({ sessionId, recordingSid });
  await recordEvent(sessionId, "recording_ready", "Call recording is ready.", { recordingSid });
  logger.info("Recording ready.", { sessionId, recordingSid });

  if (!config.twilio.intelligenceServiceSid) {
    logger.info("INTELLIGENCE_SERVICE_SID not set -- recording saved but not transcribed.", {
      sessionId,
    });
    return;
  }

  try {
    const transcript = await createTranscript({ customerKey: sessionId, recordingSid });
    await sessionRepository.updateSession(sessionId, { transcriptSid: transcript.sid });
    await transcriptRepository.createTranscript({ sessionId, transcriptSid: transcript.sid });
    await recordEvent(sessionId, "transcript_requested", "Transcript requested — processing.", {
      transcriptSid: transcript.sid,
    });
    logger.info("Transcript requested (processing async).", {
      sessionId,
      transcriptSid: transcript.sid,
    });
  } catch (err) {
    logger.error("Failed to create transcript.", { sessionId, error: (err as Error).message });
  }
}

/**
 * A Conversation Intelligence transcript finished processing. Fetch the sentences,
 * assemble the final speaker-labeled transcript, and persist it.
 */
export async function handleTranscriptComplete(
  transcriptSid: string,
  sessionId?: string
): Promise<void> {
  try {
    const sentences = await listTranscriptSentences(transcriptSid);

    const ordered = [...sentences].sort((a, b) => a.sentenceIndex - b.sentenceIndex);
    const ciTranscript: CiTranscriptLine[] = ordered.map((s) => ({
      // Channel 2 is the dialed leg (B); anything else is A.
      speaker: s.mediaChannel === 2 ? "B" : "A",
      text: s.transcript,
      confidence: s.confidence != null ? Number(s.confidence) : null,
    }));

    if (sessionId) {
      await sessionRepository.updateSession(sessionId, { transcriptSid, ciTranscript });
      await transcriptRepository.updateTranscript(transcriptSid, {
        status: "completed",
        sentences: sentences as unknown as Record<string, unknown>[],
      });
      await recordEvent(sessionId, "transcript_ready", "Transcript finished processing.", {
        transcriptSid,
      });
      // In-app notification so the provider knows to check the session details.
      await notificationRepository.createNotification({
        sessionId,
        type: "transcript_ready",
        title: "Transcript ready",
        body: "Your Call Connect transcript has finished processing. Open the session to review it.",
      });
    }

    const pretty = ciTranscript.map((line) => `${line.speaker}: ${line.text}`).join("\n");
    logger.info("Post-call transcript ready.", {
      sessionId: sessionId ?? transcriptSid,
      transcript: pretty,
    });
    // This is the clean, speaker-labeled "after the call" transcript.
    // Persist it, email it, run analysis, etc.
  } catch (err) {
    logger.error("Failed to fetch transcript sentences.", {
      transcriptSid,
      error: (err as Error).message,
    });
  }
}
