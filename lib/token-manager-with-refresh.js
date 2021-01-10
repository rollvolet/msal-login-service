import schedule from 'node-schedule';
import TokenManager, { getTokenInfo } from './token-manager';
import { updateTokenInfoForSession, removeSession, getAllOAuthSessions } from './session';
import cachePlugin from './cache-plugin';

export default class TokenManagerWithRefresh extends TokenManager {
  constructor() {
    super(...arguments);
    this.jobs = {}; // token refresh jobs per session id
    this.restore();
    this.tokenRenewalOffsetSeconds = parseInt(process.env.AUTH_TOKEN_RENEWAL_OFFSET) || 300;
  }

  get tokenRenewalOffset() {
    return this.tokenRenewalOffsetSeconds * 1000;
  }

  get tokenCache() {
    return this.clientApp.getTokenCache();
  }

  /**
   * @private
   */
  configureCache(config) {
    config['cache'] = { cachePlugin: cachePlugin };
  }

  /**
   * @private
   */
  async restore() {
    console.log(`Restoring persisted session states...`);
    const activeSessions = await getAllOAuthSessions();

    console.log(`Initialize background token refresh job for each session`);
    const activeAccountIds = [];
    for (let activeSession of activeSessions) {
      const account = await this.tokenCache.getAccountByHomeId(activeSession.accountId);
      if (account) {
        const tokenInfo = {
          homeAccountId: activeSession.accountId,
          accessToken: activeSession.accessToken,
          expirationDate: new Date(Date.parse(activeSession.expirationDate))
        };
        this.scheduleTokenRefresh(activeSession.session, tokenInfo);
        activeAccountIds.push(account.homeAccountId);
      } else {
        console.log(`No account with id ${activeSession.accountId} found in token cache for session <${activeSession.session}>. Session will be removed from triplestore.`);
        await removeSession(activeSession.session);
      }
    }

    console.log(`Cleanup token cache for sessions that don't exist anymore`);
    const cachedAccounts = await this.tokenCache.getAllAccounts();
    for (let cachedAccount of cachedAccounts) {
      if (!activeAccountIds.includes(cachedAccount.homeAccountId))
        await this.tokenCache.removeAccount(cachedAccount);
    }

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
        const account = await this.tokenCache.getAccountByHomeId(accountId);
        if (account)
          await this.tokenCache.removeAccount(account);
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
        account = await this.tokenCache.getAccountByHomeId(accountId);
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
          await this.tokenCache.removeAccount(account);
        } catch (e) {
          console.warn(`Failed to remove token for account ${account.username} from token cache.`);
          console.warn(e);
        }
    }
  }

}
