// The sample behind the teleteka stub bug (A2), in plain JS so the pinned test (CH-19)
// and the bug-report capture (scripts/bug-report/capture.mjs) pick the same programmes
// and tell the stub the same way. Changing a limit or the stub marker here changes
// both, so they can't disagree on whether the bug reproduces for that reason.

/** How far back the EPG is read, in seconds. */
export const TELETEKA_EPG_SPAN = 24 * 60 * 60;
/** Channels looked at, programmes taken per channel, and programmes in all. */
export const TELETEKA_SAMPLE = { channels: 40, perChannel: 2, total: 12 };

/**
 * The channels looked at: playable and unprotected (a protected channel answers 403
 * for the missing code, not for the recording), the first `TELETEKA_SAMPLE.channels`.
 * @template {{ playable: boolean, access: { protected: boolean } }} C
 * @param {C[]} channels
 * @returns {C[]}
 */
export const teletekaChannels = (channels) =>
  channels.filter((c) => c.playable && !c.access.protected).slice(0, TELETEKA_SAMPLE.channels);

/**
 * Programmes that have ended and that the EPG marks as having no recording
 * (`teleteka: false`), at most `TELETEKA_SAMPLE.perChannel` of one channel's EPG.
 * @template {{ teleteka: boolean, ends_at: number }} P
 * @param {P[]} items
 * @param {number} now unix seconds
 * @returns {P[]}
 */
export const programmesWithoutRecording = (items, now) =>
  items.filter((p) => !p.teleteka && p.ends_at < now).slice(0, TELETEKA_SAMPLE.perChannel);

/**
 * Whether a teleteka stream is the placeholder clip the server plays instead of the
 * documented 403 E_ARCHIVE_NOT_AVAILABLE.
 * @param {string | null | undefined} url
 */
export const isTeletekaStub = (url) => String(url ?? '').includes('/zaglushka/');
