import schedule from 'node-schedule';
import TokenManager, { getTokenInfo } from './token-manager';
import { updateTokenInfoForSession, removeSession, getAllOAuthSessions } from './session';
import SessionCachePlugin from './session-cache-plugin';

export default class TokenManagerWithRefresh extends TokenManager {
  constructor() {
    const cachePlugin = new SessionCachePlugin();
    super(cachePlugin);
    this.jobs = {}; // token refresh jobs per session id
    this.tokenRenewalOffsetSeconds = parseInt(process.env.AUTH_TOKEN_RENEWAL_OFFSET) || 300;
    this.currentSession = null;
    this.restore();
  }

  get tokenRenewalOffset() {
    return this.tokenRenewalOffsetSeconds * 1000;
  }

  /**
   * When using a distributed token cache, MSAL's in-memory cache should only load
   * the cache blob for the currently served user (session) from the persistence store.
   * This method re-initializes MSAL's cache plugin to be scoped for the given session
   * (unless already done) before returning the MSAL token cache instance.
   *
   * @private
   */
  getMsalCache(sessionUri) {
    if (this.currentSession != sessionUri) {
      this.scopeMsalCache(sessionUri);
    }
    // else: cache already scoped by session
    return this.clientApp.getTokenCache();
  }

  scopeMsalCache(sessionUri) {
    console.log(`Scoping cache for session ${sessionUri}`);
    this.currentSession = sessionUri;
    const sessionCachePlugin = this.clientApp.tokenCache.persistence;
    sessionCachePlugin.sessionUri = sessionUri;
  }

  /**
   * @private
   */
  async restore() {
    console.log(`Restoring persisted session states...`);
    const activeSessions = await getAllOAuthSessions();
    console.log(`Found ${activeSessions.length} sessions in the triplestore`);

    console.log(`Initialize background token refresh job for each session`);
    for (let activeSession of activeSessions) {
      const msalCache = this.getMsalCache(activeSession.session);
      const account = await msalCache.getAccountByHomeId(activeSession.accountId);
      if (account) {
        const tokenInfo = {
          homeAccountId: activeSession.accountId,
          accessToken: activeSession.accessToken,
          expirationDate: new Date(Date.parse(activeSession.expirationDate))
        };
        this.scheduleTokenRefresh(activeSession.session, tokenInfo);
      } else {
        console.log(`No account with id ${activeSession.accountId} found in token cache for session <${activeSession.session}>. Session will be removed from triplestore.`);
        await removeSession(activeSession.session);
      }
    }

    console.log(`Cleanup Redis token cache for sessions that don't exist anymore in the triplestore`);
    const sessions = activeSessions.map(a => a.session);

    const sessionCachePlugin = this.clientApp.tokenCache.persistence;
    sessionCachePlugin.redisCache.cleanAllExcept(sessions);

    console.log(`Finished restorting session state`);
  }

  /**
   * @public
  */
  scheduleTokenRefresh(session, tokenInfo) {
    const expirationDate = new Date(Date.parse(tokenInfo.expirationDate));
    console.log(`Token for session <${session}> will expire at ${expirationDate}`);
    let refreshTime = expirationDate.getTime() - this.tokenRenewalOffset;
    const now = new Date().getTime();
    if (refreshTime <= now)
      refreshTime = now + 5000; // in 5 seconds

    const refreshDate = new Date(refreshTime);
    console.log(`Schedule token refresh for session <${session}> at ${refreshDate}>`);
    const job = schedule.scheduleJob(refreshDate, function(session) {
      const jobContext = this.jobs[session];
      this.refreshToken(session, jobContext);
    }.bind(this, session));
    this.jobs[session] = {
      session,
      tokenInfo,
      job
    };
  }

  /**
   * @public
  */
  async cancelTokenRefresh(session) {
    const jobContext = this.jobs[session];
    if (jobContext) {
      console.log(`Remove background token refresh for session <${session}>`);
      jobContext.job.cancel();
      const accountId = jobContext.tokenInfo.homeAccountId;
      this.jobs[session] = null;
      try {
        const msalCache = this.getMsalCache(session);
        const account = await msalCache.getAccountByHomeId(accountId);
        if (account) {
          await msalCache.removeAccount(account);
        }
      } catch (e) {
        console.warn(`Failed to remove token for account ${accountId} from token cache.`);
        console.warn(e);
      }
    }
  }

  /**
   * @public
  */
  hasValidToken(session) {
    return this.jobs[session] != null;
  }

  /**
   * @private
  */
  async refreshToken(session, jobContext) {
    let account = null;
    try {
      if (jobContext) {
        const accountId = jobContext.tokenInfo.homeAccountId;
        account = await this.getMsalCache(session).getAccountByHomeId(accountId);
        console.log(`Trying to refresh token of session <${session}> linked to account ${account.username}`);
        const silentRequest = { account, scopes: this.scopes, forceRefresh: true };
        const authenticationResult = await this.clientApp.acquireTokenSilent(silentRequest);

        if (authenticationResult) { // schedule next token refresh on success
          console.log(`Successfully refreshed token of session <${session}>`);
          if (process.env['DEBUG_MSAL_AUTH']) {
            console.log(`Received authenticationResult ${JSON.stringify(authenticationResult)}`);
          }
          const tokenInfo = getTokenInfo(authenticationResult);
          await updateTokenInfoForSession(session, tokenInfo);
          this.scheduleTokenRefresh(session, tokenInfo);
        } else {
          console.warn(`Received empty response on refresh token of session <${session}>`);
          this.jobs[session] = null;
        }
      } else {
        console.log(`No scheduled job found for session <${session}>`);
        this.jobs[session] = null;
      }
    } catch (e) {
      console.warn(`Something went wrong while refreshing token for session <${session}>`);
      console.warn(e);
      this.jobs[session] = null;
    }

    if (this.jobs[session] == null) {
      console.warn(`Unable to refresh token for session <${session}>. Session will be logged out.`);
      await removeSession(session);
      if (account)
        try {
          await this.getMsalCache(session).removeAccount(account);
        } catch (e) {
          console.warn(`Failed to remove token for account ${account.username} from token cache.`);
          console.warn(e);
        }
    }
  }
}
