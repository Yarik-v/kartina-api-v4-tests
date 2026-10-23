import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { ProfilePayload, SettingName } from './types';

export interface LoginBody {
  login: string;
  password: string;
  device: string;
  serial: string;
  push_token?: string;
}

type Query = Record<string, string | number | boolean>;

export interface CallOptions {
  params?: Query;
  headers?: Record<string, string>;
}

const seg = (value: string | number) => encodeURIComponent(String(value));

/**
 * A `*_url` from a response (`/api/v4/channels/1/play`) as a path relative to the
 * base URL, so it can be passed to `raw`.
 */
export function apiPath(url: string): string {
  if (!url.startsWith('/api/v4/')) throw new Error(`Not an /api/v4/ path: ${url}`);
  return url.slice('/api/v4/'.length);
}

/**
 * Thin typed wrapper over API v4: one method per operation, named after its
 * `operationId`. Methods return the raw `APIResponse`, so tests assert on errors too.
 * Operations the suite never calls (sharing codes, protect-code change, clearing the
 * search history) have no method and are reachable only via `raw`.
 */
export class V4ApiClient {
  constructor(private readonly request: APIRequestContext) {}

  /** Any method and path, for tests that sweep the whole spec. */
  raw(method: string, path: string, options: CallOptions & { data?: unknown } = {}): Promise<APIResponse> {
    return this.request.fetch(path, { method, maxRedirects: 0, ...options });
  }

  // Security

  login(body: LoginBody): Promise<APIResponse> {
    return this.request.post('login', { data: body });
  }

  /** Like `login`, but accepts any payload, for the documented 400 cases. */
  loginRaw(body: unknown): Promise<APIResponse> {
    return this.request.post('login', { data: body });
  }

  logout(): Promise<APIResponse> {
    return this.request.post('logout');
  }

  // Client

  getAccount(): Promise<APIResponse> {
    return this.request.get('account');
  }

  getSettings(): Promise<APIResponse> {
    return this.request.get('settings');
  }

  changeSetting(name: SettingName, value: string | number): Promise<APIResponse> {
    return this.request.post('settings', { data: { name, value } });
  }

  changeSettingRaw(body: unknown): Promise<APIResponse> {
    return this.request.post('settings', { data: body });
  }

  checkProtectCode(body: unknown): Promise<APIResponse> {
    return this.request.post('protect-code/check', { data: body });
  }

  // Profiles

  listProfiles(): Promise<APIResponse> {
    return this.request.get('profiles');
  }

  createProfile(payload: ProfilePayload | Record<string, unknown>): Promise<APIResponse> {
    return this.request.post('profiles', { data: payload });
  }

  getCurrentProfile(): Promise<APIResponse> {
    return this.request.get('profiles/current');
  }

  switchCurrentProfile(body: unknown): Promise<APIResponse> {
    return this.request.put('profiles/current', { data: body });
  }

  getProfile(id: number | string): Promise<APIResponse> {
    return this.request.get(`profiles/${seg(id)}`);
  }

  replaceProfile(id: number | string, payload: ProfilePayload | Record<string, unknown>): Promise<APIResponse> {
    return this.request.put(`profiles/${seg(id)}`, { data: payload });
  }

  updateProfile(id: number | string, payload: ProfilePayload | Record<string, unknown>): Promise<APIResponse> {
    return this.request.patch(`profiles/${seg(id)}`, { data: payload });
  }

  deleteProfile(id: number | string): Promise<APIResponse> {
    return this.request.delete(`profiles/${seg(id)}`);
  }

  // Favorites

  getFavorites(options?: CallOptions): Promise<APIResponse> {
    return this.request.get('favorites', options);
  }

  getFavoritesByService(service: string): Promise<APIResponse> {
    return this.request.get(`favorites/${seg(service)}`);
  }

  addContentFavorite(service: string, id: string): Promise<APIResponse> {
    return this.request.put(`content/${seg(service)}/${seg(id)}/favorite`);
  }

  removeContentFavorite(service: string, id: string): Promise<APIResponse> {
    return this.request.delete(`content/${seg(service)}/${seg(id)}/favorite`);
  }

  addChannelFavorite(id: string | number): Promise<APIResponse> {
    return this.request.put(`channels/${seg(id)}/favorite`);
  }

  removeChannelFavorite(id: string | number): Promise<APIResponse> {
    return this.request.delete(`channels/${seg(id)}/favorite`);
  }

  // Registration prompt

  /** Only ever called with an invalid action: a valid one changes the account for good. */
  dismissRegistrationPrompt(form: Record<string, string>): Promise<APIResponse> {
    return this.request.post('registration-prompt/dismiss', { form });
  }

  // Sharing

  getSharingLink(): Promise<APIResponse> {
    return this.request.get('sharing/link');
  }

  redeemSharingLink(body: unknown): Promise<APIResponse> {
    return this.request.post('sharing/redeem', { data: body });
  }

  getSharingStatus(): Promise<APIResponse> {
    return this.request.get('sharing/status');
  }

  getSharingFriends(): Promise<APIResponse> {
    return this.request.get('sharing/friends');
  }

  // Services

  getServices(): Promise<APIResponse> {
    return this.request.get('services');
  }

  getServiceCredentials(service: string): Promise<APIResponse> {
    return this.request.get(`services/${seg(service)}/credentials`);
  }

  getServicePages(service: string): Promise<APIResponse> {
    return this.request.get(`services/${seg(service)}/pages`);
  }

  // Channels

  getChannels(options?: CallOptions): Promise<APIResponse> {
    return this.request.get('channels', options);
  }

  getChannelEpg(id: string | number, params?: Query): Promise<APIResponse> {
    return this.request.get(`channels/${seg(id)}/epg`, { params });
  }

  playChannel(id: string | number, params?: Query): Promise<APIResponse> {
    return this.request.get(`channels/${seg(id)}/play`, { params });
  }

  playChannelArchive(id: string | number, timestamp: number | string, params?: Query): Promise<APIResponse> {
    return this.request.get(`channels/${seg(id)}/archive/${seg(timestamp)}`, { params });
  }

  playChannelTeleteka(id: string | number, timestamp: number | string, params?: Query): Promise<APIResponse> {
    return this.request.get(`channels/${seg(id)}/teleteka/${seg(timestamp)}`, { params });
  }

  hideChannel(id: string | number, body: unknown): Promise<APIResponse> {
    return this.request.put(`channels/${seg(id)}/hidden`, { data: body });
  }

  unhideChannel(id: string | number, body: unknown): Promise<APIResponse> {
    return this.request.delete(`channels/${seg(id)}/hidden`, { data: body });
  }

  clearHiddenChannels(body: unknown): Promise<APIResponse> {
    return this.request.delete('channels/hidden', { data: body });
  }

  // Content

  getContentDetails(service: string, id: string): Promise<APIResponse> {
    return this.request.get(`content/${seg(service)}/${seg(id)}`);
  }

  getContentSimilar(service: string, id: string): Promise<APIResponse> {
    return this.request.get(`content/${seg(service)}/${seg(id)}/similar`);
  }

  playContent(service: string, id: string): Promise<APIResponse> {
    return this.request.get(`content/${seg(service)}/${seg(id)}/play`);
  }

  playContentEpisode(service: string, id: string, seasonNumber: number, episodeId: string): Promise<APIResponse> {
    return this.request.get(
      `content/${seg(service)}/${seg(id)}/seasons/${seg(seasonNumber)}/episodes/${seg(episodeId)}/play`,
    );
  }

  playContentFreeEpisode(service: string, episodeId: string): Promise<APIResponse> {
    return this.request.get(`content/${seg(service)}/free/${seg(episodeId)}/play`);
  }

  playContentTrailer(service: string, id: string, trailerId: string): Promise<APIResponse> {
    return this.request.get(`content/${seg(service)}/${seg(id)}/trailers/${seg(trailerId)}/play`);
  }

  // Radio (deprecated in favor of the radio page and its channel group)

  getRadio(): Promise<APIResponse> {
    return this.request.get('radio');
  }

  playRadio(id: string | number): Promise<APIResponse> {
    return this.request.get(`radio/${seg(id)}`);
  }

  // Search

  searchServices(params?: Query): Promise<APIResponse> {
    return this.request.get('search/services', { params });
  }

  searchServicesCountries(params?: Query): Promise<APIResponse> {
    return this.request.get('search/services/countries', { params });
  }

  searchServicesGenres(params?: Query): Promise<APIResponse> {
    return this.request.get('search/services/genres', { params });
  }

  getSearchHistory(): Promise<APIResponse> {
    return this.request.get('search/history');
  }

  addSearchHistoryEntry(body: unknown): Promise<APIResponse> {
    return this.request.post('search/history', { data: body });
  }

  // Pages and blocks

  getTvPage(): Promise<APIResponse> {
    return this.request.get('pages/tv');
  }

  getRadioPage(): Promise<APIResponse> {
    return this.request.get('pages/radio');
  }

  getPage(slug: string): Promise<APIResponse> {
    return this.request.get(`pages/${seg(slug)}`);
  }

  getPageBlock(slug: string, id: string): Promise<APIResponse> {
    return this.request.get(`pages/${seg(slug)}/blocks/${seg(id)}`);
  }

  followPageBlockLink(slug: string, id: string, link: string): Promise<APIResponse> {
    return this.request.get(`pages/${seg(slug)}/blocks/${seg(id)}/${seg(link)}`, { maxRedirects: 0 });
  }

  getTvChannelGroupBlock(id: string): Promise<APIResponse> {
    return this.request.get(`pages/tv/channel-groups/${seg(id)}`);
  }

  getRadioChannelGroupBlock(): Promise<APIResponse> {
    return this.request.get('pages/radio/channel-group');
  }

  getPlaybackBlock(params?: Query): Promise<APIResponse> {
    return this.request.get('blocks/playback', { params });
  }

  getPlaybackBlockByOrigin(origin: string, params?: Query): Promise<APIResponse> {
    return this.request.get(`blocks/playback/${seg(origin)}`, { params });
  }

  getWatchingNowBlock(): Promise<APIResponse> {
    return this.request.get('blocks/watching-now');
  }

  getRecommendationsBlock(): Promise<APIResponse> {
    return this.request.get('blocks/recommendations');
  }

  getClientChannelsBlock(): Promise<APIResponse> {
    return this.request.get('blocks/client-channels');
  }

  getLastNewsBlock(): Promise<APIResponse> {
    return this.request.get('blocks/last-news');
  }

  // Other

  getServertime(): Promise<APIResponse> {
    return this.request.get('servertime');
  }

  getScreensaver(): Promise<APIResponse> {
    return this.request.get('screensaver');
  }

  getSpeedtest(): Promise<APIResponse> {
    return this.request.get('speedtest');
  }
}
