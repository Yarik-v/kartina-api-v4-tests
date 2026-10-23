// The sample behind the teleteka stub bug (A2), shared by the pinned test (CH-19) and
// the bug-report capture so both pick the same programmes and spot the stub the same way.

/** How far back the EPG is read, in seconds. */
export const TELETEKA_EPG_SPAN = 24 * 60 * 60;
/** Channels looked at, programmes taken per channel, and programmes in all. */
export const TELETEKA_SAMPLE = { channels: 40, perChannel: 2, total: 12 };

/**
 * Playable, unprotected channels (a protected one answers 403 for the missing code),
 * the first `TELETEKA_SAMPLE.channels`.
 * @template {{ playable: boolean, access: { protected: boolean } }} C
 * @param {C[]} channels
 * @returns {C[]}
 */
export const teletekaChannels = (channels) =>
  channels.filter((c) => c.playable && !c.access.protected).slice(0, TELETEKA_SAMPLE.channels);

/**
 * Ended programmes the EPG marks `teleteka: false`, at most `TELETEKA_SAMPLE.perChannel`.
 * @template {{ teleteka: boolean, ends_at: number }} P
 * @param {P[]} items
 * @param {number} now unix seconds
 * @returns {P[]}
 */
export const programmesWithoutRecording = (items, now) =>
  items.filter((p) => !p.teleteka && p.ends_at < now).slice(0, TELETEKA_SAMPLE.perChannel);

/**
 * Whether a teleteka stream is the placeholder clip played instead of the documented 403.
 * @param {string | null | undefined} url
 */
export const isTeletekaStub = (url) => String(url ?? '').includes('/zaglushka/');
