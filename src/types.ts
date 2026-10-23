// Response types for API v4, mirroring components.schemas of spec/openapi.yaml.
// Only what the tests read is typed; the schema checks cover the rest.

export interface ApiError {
  error: {
    type: string | null;
    code: number;
    message: string;
    request_id: string;
    details: { title: string | null; description: string | null };
  };
}

export interface Packet {
  id: number;
  title: string;
  type: string;
  share_links: string | null;
}

/** POST /login and GET /account. */
export interface Account {
  login: number;
  expire_at: number;
  packet: Packet;
  security: string;
  services: string;
  settings: string;
  has_personal_account: boolean | null;
  registration_prompt: { show: boolean; prompt_count: 1 | 2 };
  mirror?: string;
}

export interface SettingOption {
  value: string | number;
  label: string;
}

export interface Setting {
  value: string | number;
  allowed: SettingOption[];
}

/** The settings that are a choice among `allowed` values. */
export const CHOICE_SETTINGS = ['standard', 'server', 'bitrate', 'caching', 'timeshift'] as const;
export type ChoiceSetting = (typeof CHOICE_SETTINGS)[number];
export type SettingName = ChoiceSetting | 'catchup';

export type ClientSettings = Record<ChoiceSetting, Setting> & {
  /** `delay` and `length` follow the current `standard`. */
  catchup: { enabled: 0 | 1; delay: number; length: number };
};

export interface ChannelAccess {
  protected: boolean;
  hidden: boolean;
}

export interface ChannelCapabilities {
  archive: boolean;
  timeshift: boolean;
}

export interface ChannelListCard {
  id: string;
  group_id: string;
  kind: 'channel' | 'playlist';
  title: string;
  playable: boolean;
  favorite: boolean;
  capabilities: ChannelCapabilities;
  access: ChannelAccess;
  play_url: string;
  epg_url: string;
  favorite_url?: string;
}

export interface ChannelsList {
  count: number;
  items: ChannelListCard[];
}

export interface EpgProgramme {
  starts_at: number;
  ends_at: number;
  title: string;
  teleteka: boolean;
  playable: boolean;
  play_url: string;
}

export interface ChannelEpg {
  channel: { id: string; archive_url?: string };
  count: number;
  items: EpgProgramme[];
}

export interface PlaybackStream {
  url: string;
  markers: unknown;
  vmap: string | null;
}

export interface BlockSummary {
  id: string;
  title: string;
  type: string;
  block_url: string;
  count?: number;
  protected?: boolean;
}

export interface Page {
  id: string;
  slug: string;
  title: string;
  items: BlockSummary[];
}

export interface Progress {
  position: number;
  duration: number | null;
  completed: boolean;
  updated_at: number | null;
}

export interface ContentCard {
  id: string;
  kind: 'movie' | 'series';
  service: string;
  title: string;
  playable: boolean;
  favorite: boolean;
  progress: Progress | null;
  details_url: string;
  favorite_url: string;
  trailer_url?: string;
}

export interface Block {
  id: string;
  title: string;
  type: string;
  count: number;
  items: ContentCard[];
  links?: Record<string, unknown>;
}

export interface Episode {
  id: string;
  kind: 'episode';
  number: number;
  title: string;
  play_url?: string;
}

export interface Season {
  id: string;
  number: number | null;
  title: string;
  episode_count: number;
  episodes: Episode[];
}

export interface Trailer {
  id: string;
  title: string;
  play_url: string;
}

export interface ContentDetails {
  id: string;
  service: string;
  kind: 'movie' | 'series';
  title: { original: string; display: string; short: string };
  year: string | null;
  genres: string[];
  playable: boolean;
  favorite: boolean;
  progress: Progress;
  trailers: Trailer[];
  seasons: Season[];
  play_url: string;
  favorite_url: string;
  similar_url: string;
}

export interface CardList<T> {
  id: string;
  title: string;
  type: string;
  count: number;
  items: T[];
}

export interface ChannelCard {
  id: string;
  kind: 'channel' | 'playlist' | 'radio';
  title: string;
  playable: boolean;
  favorite: boolean;
  access: ChannelAccess;
  play_url: string;
}

export interface FavoriteItem {
  id: string;
  kind: string;
  service?: string;
  title: string;
  favorite: boolean;
}

export interface FavoritesList {
  count: number;
  items: FavoriteItem[];
}

export const AGE_BANDS = [0, 7, 12, 16] as const;
export const AVATARS = ['default', 'avatar_1', 'avatar_2', 'avatar_3', 'avatar_4', 'avatar_5'] as const;

export interface Profile {
  id: number;
  is_main: boolean;
  name: string | null;
  avatar: (typeof AVATARS)[number] | null;
  age_band: (typeof AGE_BANDS)[number];
}

export interface ProfilePayload {
  name: string;
  avatar?: (typeof AVATARS)[number] | null;
  age_band: (typeof AGE_BANDS)[number];
}

export interface Service {
  id: string;
  type: 'video' | 'audio';
  name: string;
  status: 'available' | 'unavailable';
  access: { state: string; subscription_id: string | number | null };
  pages_url: string | null;
  credentials_url: string | null;
}

export interface SearchResults {
  total: number;
  offset: number;
  limit: number;
  count: number;
  items: { id: string; kind: string; service: string; title: string }[];
  prev_url?: string;
  next_url?: string;
}

export interface SearchHistory {
  count: number;
  items: string[];
  history_url: string;
  search_url: string;
}

export interface SearchFacets {
  count: number;
  items: { title: string; count: number }[];
  search_url: string;
}

export interface RadioStation {
  id: number;
  title: string;
  type: string;
  _links: { play: { method: string; path?: string | null } };
}

export interface RadioCard {
  id: string;
  kind: string;
  title: string;
  playable: boolean;
  play_url: string;
}
