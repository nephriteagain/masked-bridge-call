import type { Request, Response } from "express";

import { fetchTranscript, listTranscriptSentences } from "../services/twilio.service.js";
import { AppError, NotFoundError, UpstreamError } from "../utils/errors.js";

/**
 * Transcript inspection: fetch a Conversation Intelligence transcript straight from
 * Twilio by its SID. This bypasses our stored `ciTranscript` and returns Twilio's
 * live view — useful for debugging processing status and comparing raw data.
 */

/** Shape of the errors the Twilio SDK throws (status + code + moreInfo). */
interface TwilioError {
  status?: number;
  code?: number;
  message?: string;
}

/**
 * GET /transcripts/:sid[?sentences=false]
 * Returns the transcript's metadata and (by default) its ordered sentences.
 */
export async function getTranscript(req: Request, res: Response): Promise<void> {
  const sid = req.params.sid;
  const includeSentences = req.query.sentences !== "false";

  let transcript: Awaited<ReturnType<typeof fetchTranscript>>;
  try {
    transcript = await fetchTranscript(sid);
  } catch (err) {
    const te = err as TwilioError;
    if (te.status === 404) {
      throw new NotFoundError(`Transcript ${sid} not found`);
    }
    if (te.status === 401 || te.status === 403) {
      throw new AppError(
        te.status,
        "Not authorized to read this transcript. Check the API key's Voice Intelligence permissions.",
        te.message
      );
    }
    throw new UpstreamError("Failed to fetch transcript from Twilio", te.message);
  }

  // Only fetch sentences once the transcript is done; earlier they don't exist yet.
  const sentences =
    includeSentences && transcript.status === "completed"
      ? await listTranscriptSentences(sid)
      : [];

  res.json({
    transcript,
    sentences,
    sentenceCount: sentences.length,
  });
}
